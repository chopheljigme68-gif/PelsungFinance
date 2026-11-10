import { and, eq, inArray, isNull, sql as raw } from "drizzle-orm";
import { db, type DbExecutor } from "../../db/client.js";
import { payrollRunItems, payrollRuns, supplierTdsRemittanceRuns, voucherBudgetLines, vouchers } from "../../db/schema.js";
import {
  EDITABLE_VOUCHER_STATUSES,
  EMAIL_PATTERN,
  TPN_PATTERN,
  budgetLineSign,
  calculateVoucherDeductions,
  formatVoucherNumber,
  isVoucherEditableBy,
  receiptCreditsBudget,
  roundNu,
  type ReceiptCategory,
  type VoucherStatus,
  type VoucherType,
} from "../../domain/vouchers.js";
import { currentBhutanDate, fiscalYearEndDate, fiscalYearStartDate } from "../../domain/fiscal-year.js";
import { BANK_LEDGER_CODE, findLedger } from "../../domain/reference.js";
import { audit } from "../../lib/audit.js";
import { EmailDeliveryError, sendPayrollPayslipEmail } from "../../lib/email.js";
import { PG_UNIQUE_VIOLATION, badRequest, conflict, forbidden, isPostgresError } from "../../lib/errors.js";
import { isAccountingMonthClosed } from "../reconciliation/reconciliation.service.js";
import { isTpnRegistered } from "../tpn/tpn.service.js";
import { logger } from "../../lib/logger.js";
import { loadActivityBalances, loadOutstandingAdvance, nextVoucherSerial } from "../accounting/accounting.service.js";
import type { PayslipDelivery } from "../accounting/accounting.types.js";
import { can, type SessionUser } from "../auth/auth.service.js";

export type BudgetLineInput = { activityId: number; amountNu: number };

export type CreateVoucherInput = {
  voucherType: VoucherType;
  payee: string;
  tpn?: string | null;
  payeeAccountNumber?: string | null;
  payeeBankName?: string | null;
  billReference?: string | null;
  description: string;
  amountNu?: number;
  gstNu?: number;
  tdsRate?: number;
  advanceRecoveryNu?: number;
  advanceRecoveryVoucherId?: number | null;
  transactionDate: string;
  budgetLines?: BudgetLineInput[];
  activityId?: number | null;
  /** Receipts: the bank or cash ledger the money landed in. DT: the bank ledger it went through. */
  ledgerCode?: string | null;
  receiptCategory?: ReceiptCategory | null;
};

type ActivityBalances = Awaited<ReturnType<typeof loadActivityBalances>>;

/**
 * Budget rule for one set of voucher lines, shared by create, approve and
 * reverse so the three can never disagree.
 *
 * Spending lines (payments, journals, DT) may not exceed what is still
 * available on the activity. Refund lines give budget back, so they may not
 * exceed what has actually been spent on it — otherwise an activity could end
 * up with more available than was ever approved.
 */
function assertBudgetLinesFit(
  lines: BudgetLineInput[],
  balances: ActivityBalances,
  direction: "spend" | "refund",
  verb: string,
): void {
  for (const line of lines) {
    const balance = balances.get(line.activityId);
    if (!balance) throw conflict("One of the selected budget activities was not found in this financial year.");
    if (direction === "spend" && line.amountNu > balance.availableNu) {
      throw conflict(
        `${balance.obc} · ${balance.activity} ${verb} because the allocation is greater than the available balance.`,
        { availableBalanceNu: balance.availableNu, expenditureAmountNu: line.amountNu },
      );
    }
    if (direction === "refund" && line.amountNu > balance.committedNu) {
      throw conflict(
        `${balance.obc} · ${balance.activity} ${verb} because the refund is greater than the expenditure booked against it (Nu. ${balance.committedNu}).`,
      );
    }
  }
}

/**
 * Creates a Pending voucher.
 *
 * Payments, journals and direct transactions (DT) must be allocated across one
 * or more approved budget activities, and the sum of those allocations *is*
 * the voucher amount. A refund receipt is allocated the same way but credits
 * the activities back. Advances, fund receipts and other receipts carry no
 * budget impact at all.
 *
 * The money side follows the ledger: receipts land in the bank or in cash; a
 * DT records the bank ledger it went through but, by definition, does not move
 * the system bank balance.
 */
async function prepareVoucherPosting(user: SessionUser, input: CreateVoucherInput) {
  const isReceipt = input.voucherType === "Receipt";
  const isPayment = input.voucherType === "Payment";
  const isDirectTransaction = input.voucherType === "DT";
  const receiptCategory: ReceiptCategory | null = isReceipt ? (input.receiptCategory ?? "Fund receipt") : null;
  const isRefund = isReceipt && receiptCreditsBudget(receiptCategory);
  const spendsBudget = budgetLineSign(input.voucherType) === 1;
  const hasNoBudgetImpact = !spendsBudget && !isRefund;

  if (isReceipt ? !can(user, "record_fund_receipt") : !can(user, "create_voucher")) throw forbidden();

  // Only receipts and DTs choose a ledger; everything else runs through the operating bank.
  if (isDirectTransaction && !input.ledgerCode) {
    throw badRequest("Select the bank ledger the direct transaction went through.");
  }
  const ledger = findLedger(isReceipt || isDirectTransaction ? input.ledgerCode : BANK_LEDGER_CODE);
  if (!ledger) throw badRequest("Select a valid bank or cash ledger.");
  if (isDirectTransaction && ledger.kind !== "bank") {
    throw badRequest("A direct transaction must be recorded against a bank ledger.");
  }

  const budgetLines: BudgetLineInput[] = hasNoBudgetImpact
    ? []
    : (input.budgetLines?.length
        ? input.budgetLines
        : [{ activityId: Number(input.activityId), amountNu: Number(input.amountNu) }]
      ).map((line) => ({ activityId: Number(line.activityId), amountNu: roundNu(Number(line.amountNu)) }));

  if (!hasNoBudgetImpact) {
    const uniqueActivityIds = new Set(budgetLines.map((line) => line.activityId));
    const valid =
      budgetLines.length > 0 &&
      budgetLines.length <= 25 &&
      uniqueActivityIds.size === budgetLines.length &&
      budgetLines.every(
        (line) => Number.isInteger(line.activityId) && line.activityId > 0 && Number.isFinite(line.amountNu) && line.amountNu > 0,
      );
    if (!valid) {
      throw badRequest(
        isRefund
          ? "Select the budget activity being refunded and enter a positive amount for every line."
          : "Select an approved budget activity and enter a positive amount for every allocation line.",
      );
    }
  }

  const amountNu = hasNoBudgetImpact
    ? roundNu(Number(input.amountNu))
    : roundNu(budgetLines.reduce((sum, line) => sum + line.amountNu, 0));
  if (!Number.isFinite(amountNu) || amountNu <= 0) throw badRequest("Enter a valid positive voucher amount.");

  const gstNu = isPayment ? roundNu(Number(input.gstNu ?? 0)) : 0;
  const tdsRate = isPayment ? Math.round(Number(input.tdsRate ?? 0)) : 0;
  const advanceRecoveryNu = isPayment ? roundNu(Number(input.advanceRecoveryNu ?? 0)) : 0;
  const advanceRecoveryVoucherId = advanceRecoveryNu > 0 ? Number(input.advanceRecoveryVoucherId ?? 0) || null : null;

  const { tdsNu, netPaymentNu: paymentNetNu } = calculateVoucherDeductions(amountNu, gstNu, tdsRate, advanceRecoveryNu);
  const netPaymentNu = isPayment ? paymentNetNu : amountNu;

  if (gstNu < 0 || gstNu > amountNu) throw badRequest("GST cannot be greater than the gross amount.");
  if (advanceRecoveryNu < 0) throw badRequest("Advance recovery cannot be negative.");
  if (advanceRecoveryNu > 0 && !advanceRecoveryVoucherId) throw badRequest("Select the advance being recovered.");
  if (netPaymentNu <= 0) throw badRequest("Total deductions must be less than the gross amount.");

  const requiresTpn = isPayment && [2, 5].includes(tdsRate);
  const tpn = (input.tpn ?? "").trim().toLocaleUpperCase();
  if (requiresTpn && !(tpn.length > 0 && tpn.length <= 30 && TPN_PATTERN.test(tpn))) {
    throw badRequest("Enter the payee's TPN before submitting a voucher with 2% or 5% TDS.");
  }
  // The TPN on a TDS voucher must come from the registry (registered-only).
  if (requiresTpn && !(await isTpnRegistered(tpn))) {
    throw badRequest(`TPN ${tpn} is not registered. Register it under Accounts → TPN Registration first.`);
  }

  return {
    receiptCategory,
    isRefund,
    hasNoBudgetImpact,
    ledger,
    budgetLines,
    amountNu,
    gstNu,
    tdsRate,
    tdsNu,
    advanceRecoveryNu,
    advanceRecoveryVoucherId,
    netPaymentNu,
    tpn: requiresTpn ? tpn : null,
  };
}

type PreparedVoucher = Awaited<ReturnType<typeof prepareVoucherPosting>>;

/**
 * Balance checks that must run inside the posting transaction, with the
 * activity rows locked, because balances can move between requests. Only
 * Approved/Paid vouchers count toward balances, so a Pending voucher being
 * edited never double-counts its own previous lines.
 */
async function verifyVoucherBalances(tx: DbExecutor, fiscalYear: string, prepared: PreparedVoucher): Promise<void> {
  const { advanceRecoveryNu, advanceRecoveryVoucherId, hasNoBudgetImpact, budgetLines, isRefund } = prepared;
  if (advanceRecoveryNu > 0 && advanceRecoveryVoucherId) {
    const advance = await loadOutstandingAdvance(tx, advanceRecoveryVoucherId, fiscalYear);
    if (!advance) throw conflict("The selected advance is no longer available for recovery.");
    if (advanceRecoveryNu > advance.outstandingNu) {
      throw conflict("Advance recovery cannot be greater than the outstanding advance balance.", {
        outstandingAdvanceNu: advance.outstandingNu,
      });
    }
  }

  if (!hasNoBudgetImpact) {
    const balances = await loadActivityBalances(
      tx,
      fiscalYear,
      budgetLines.map((line) => line.activityId),
      true,
    );
    assertBudgetLinesFit(
      budgetLines,
      balances,
      isRefund ? "refund" : "spend",
      isRefund ? "cannot take this refund" : "cannot accept this allocation",
    );
  }
}

/** The voucher columns a user enters, shared by create and edit. */
function voucherFields(input: CreateVoucherInput, prepared: PreparedVoucher) {
  return {
    activityId: prepared.hasNoBudgetImpact ? null : prepared.budgetLines[0]?.activityId ?? null,
    payee: input.payee,
    tpn: prepared.tpn,
    payeeAccountNumber: input.payeeAccountNumber?.trim() || null,
    payeeBankName: input.payeeBankName?.trim() || null,
    billReference: input.billReference?.trim() || null,
    description: input.description,
    amountNu: prepared.amountNu,
    gstNu: prepared.gstNu,
    tdsRate: prepared.tdsRate,
    tdsNu: prepared.tdsNu,
    advanceRecoveryNu: prepared.advanceRecoveryNu,
    advanceRecoveryVoucherId: prepared.advanceRecoveryVoucherId,
    netPaymentNu: prepared.netPaymentNu,
    ledgerCode: prepared.ledger.code,
    receiptCategory: prepared.receiptCategory,
    transactionDate: input.transactionDate,
  };
}

function describeVoucher(input: CreateVoucherInput, prepared: PreparedVoucher): string {
  const { receiptCategory, ledger, budgetLines, isRefund, amountNu, tdsNu, advanceRecoveryNu, netPaymentNu } = prepared;
  return `${input.voucherType}${receiptCategory ? ` (${receiptCategory})` : ""} voucher via ${ledger.code} ${ledger.name}: ${budgetLines.length} budget ${isRefund ? "refund line(s)" : "allocation(s)"}, gross Nu. ${amountNu}, TDS Nu. ${tdsNu}, advance recovery Nu. ${advanceRecoveryNu}, net Nu. ${netPaymentNu}`;
}

/**
 * A voucher records something that has already happened, so its date must lie
 * inside the fiscal year and may not be later than today (Bhutan time). Any
 * earlier month is allowed as long as it has not been closed.
 */
function assertVoucherDate(fiscalYear: string, transactionDate: string): void {
  if (transactionDate < fiscalYearStartDate(fiscalYear) || transactionDate > fiscalYearEndDate(fiscalYear)) {
    throw badRequest(`The transaction date must fall within FY ${fiscalYear}.`);
  }
  if (transactionDate > currentBhutanDate()) {
    throw badRequest("The transaction date cannot be in the future. Choose today or an earlier date.");
  }
}

export async function createVoucher(
  user: SessionUser,
  fiscalYear: string,
  input: CreateVoucherInput,
): Promise<{ voucherNumber: string }> {
  const prepared = await prepareVoucherPosting(user, input);
  assertVoucherDate(fiscalYear, input.transactionDate);

  // A closed accounting month is locked to new postings.
  if (await isAccountingMonthClosed(fiscalYear, input.transactionDate.slice(0, 7))) {
    throw conflict("A voucher cannot be created for a closed accounting month.");
  }

  const voucherNumber = await db.transaction(async (tx) => {
    await verifyVoucherBalances(tx, fiscalYear, prepared);

    const monthKey = input.transactionDate.slice(5, 7);
    const serial = await nextVoucherSerial(tx, fiscalYear, input.voucherType, monthKey);
    const number = formatVoucherNumber(input.voucherType, Number(monthKey), serial);

    const [voucher] = await tx
      .insert(vouchers)
      .values({
        ...voucherFields(input, prepared),
        voucherNumber: number,
        fiscalYear,
        voucherType: input.voucherType,
        status: "Pending",
        createdBy: user.id,
      })
      .returning({ id: vouchers.id, voucherNumber: vouchers.voucherNumber });

    if (prepared.budgetLines.length) {
      await tx.insert(voucherBudgetLines).values(
        prepared.budgetLines.map((line) => ({ voucherId: voucher.id, activityId: line.activityId, amountNu: line.amountNu })),
      );
    }

    await audit(user.id, "voucher_created", "voucher", voucher.voucherNumber, describeVoucher(input, prepared), tx);

    return voucher.voucherNumber;
  });

  return { voucherNumber };
}

/**
 * Lets the user who prepared a voucher correct it before it is approved.
 *
 * - Only the creator can edit, and only while the voucher is Pending or
 *   Rejected. Approved and Paid vouchers are posted and are corrected by
 *   reversal instead; Reversed vouchers are final.
 * - Payroll and remittance vouchers are generated from their runs and are
 *   changed by regenerating the run, never by hand.
 * - The voucher type is fixed, because the voucher number is built from it.
 *   Moving the date to another month gives the voucher the next number in that
 *   month; otherwise the number is kept.
 * - An edited voucher always goes back to Pending, so a Rejected voucher is
 *   resubmitted for approval by saving it, and every edit is re-approved.
 * - The same validation, permission, closed-month and balance rules as
 *   creation apply, all inside one transaction with the voucher row locked so
 *   an approver cannot approve it half-way through an edit.
 */
export async function updateVoucher(
  user: SessionUser,
  fiscalYear: string,
  voucherId: number,
  input: CreateVoucherInput,
): Promise<{ voucherNumber: string }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: vouchers.id,
        voucherNumber: vouchers.voucherNumber,
        voucherType: vouchers.voucherType,
        status: vouchers.status,
        createdBy: vouchers.createdBy,
        transactionDate: vouchers.transactionDate,
        payrollRunId: vouchers.payrollRunId,
        payrollRemittanceRunId: vouchers.payrollRemittanceRunId,
        supplierTdsRemittanceRunId: vouchers.supplierTdsRemittanceRunId,
        payrollEntryType: vouchers.payrollEntryType,
      })
      .from(vouchers)
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.fiscalYear, fiscalYear)))
      .for("update")
      .limit(1);

    if (!existing) throw conflict("This voucher was not found in the selected financial year.");
    if (existing.createdBy !== user.id) throw forbidden("You can only edit vouchers that you created.");
    if (!isVoucherEditableBy(existing, user.id)) {
      if (existing.payrollEntryType || existing.payrollRunId || existing.payrollRemittanceRunId || existing.supplierTdsRemittanceRunId) {
        throw conflict("Payroll and remittance vouchers are generated automatically and cannot be edited by hand.");
      }
      throw conflict(
        `Voucher ${existing.voucherNumber} is ${existing.status} and can no longer be edited.` +
          (existing.status === "Approved" || existing.status === "Paid" ? " Ask an approver to reverse it instead." : ""),
      );
    }
    if (input.voucherType !== existing.voucherType) {
      throw badRequest("The voucher type cannot be changed. Create a new voucher of the other type instead.");
    }

    const prepared = await prepareVoucherPosting(user, input);
    assertVoucherDate(fiscalYear, input.transactionDate);

    const oldMonth = existing.transactionDate.slice(0, 7);
    const newMonth = input.transactionDate.slice(0, 7);
    if (await isAccountingMonthClosed(fiscalYear, oldMonth)) {
      throw conflict("This voucher belongs to a closed accounting month and can no longer be edited.");
    }
    if (newMonth !== oldMonth && (await isAccountingMonthClosed(fiscalYear, newMonth))) {
      throw conflict("A voucher cannot be moved into a closed accounting month.");
    }

    await verifyVoucherBalances(tx, fiscalYear, prepared);

    let voucherNumber = existing.voucherNumber;
    if (newMonth !== oldMonth) {
      const monthKey = input.transactionDate.slice(5, 7);
      const serial = await nextVoucherSerial(tx, fiscalYear, input.voucherType, monthKey);
      voucherNumber = formatVoucherNumber(input.voucherType, Number(monthKey), serial);
    }

    const updated = await tx
      .update(vouchers)
      .set({
        ...voucherFields(input, prepared),
        voucherNumber,
        status: "Pending",
        approvedBy: null,
        approvedAt: null,
      })
      .where(
        and(
          eq(vouchers.id, voucherId),
          eq(vouchers.createdBy, user.id),
          inArray(vouchers.status, [...EDITABLE_VOUCHER_STATUSES]),
        ),
      )
      .returning({ id: vouchers.id });
    if (!updated.length) throw conflict("This voucher changed while you were editing it. Reload and try again.");

    await tx.delete(voucherBudgetLines).where(eq(voucherBudgetLines.voucherId, voucherId));
    if (prepared.budgetLines.length) {
      await tx.insert(voucherBudgetLines).values(
        prepared.budgetLines.map((line) => ({ voucherId, activityId: line.activityId, amountNu: line.amountNu })),
      );
    }

    const renumbered = voucherNumber !== existing.voucherNumber ? ` (renumbered from ${existing.voucherNumber})` : "";
    const resubmitted = existing.status === "Rejected" ? " and resubmitted for approval" : "";
    await audit(
      user.id,
      "voucher_edited",
      "voucher",
      voucherNumber,
      `Edited${resubmitted}${renumbered}. Now: ${describeVoucher(input, prepared)}`,
      tx,
    );

    return { voucherNumber };
  });
}

/** Draft vouchers generated by payroll/remittance are submitted by their author. */
export async function submitVoucher(user: SessionUser, fiscalYear: string, voucherId: number): Promise<void> {
  if (!can(user, "view_payroll") && !can(user, "create_voucher")) throw forbidden();

  const updated = await db
    .update(vouchers)
    .set({ status: "Pending" })
    .where(
      and(
        eq(vouchers.id, voucherId),
        eq(vouchers.fiscalYear, fiscalYear),
        eq(vouchers.createdBy, user.id),
        eq(vouchers.status, "Draft"),
        raw`${vouchers.payrollEntryType} is not null`,
      ),
    )
    .returning({ id: vouchers.id });

  if (!updated.length) {
    throw conflict("Only the user who generated an automatic Draft voucher can submit it for approval.");
  }

  await audit(user.id, "voucher_submitted", "voucher", voucherId, "Auto-generated voucher submitted for approval");
}

/**
 * Approves or returns a pending voucher.
 *
 * Approval re-verifies both the advance balance and every budget allocation
 * inside the transaction, because the balances may have moved between
 * preparation and approval.
 */
export async function decideVoucher(
  user: SessionUser,
  fiscalYear: string,
  voucherId: number,
  status: Extract<VoucherStatus, "Approved" | "Rejected">,
): Promise<{ payrollRunId: number | null; payrollEntryType: string | null }> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({
        id: vouchers.id,
        voucherType: vouchers.voucherType,
        activityId: vouchers.activityId,
        advanceRecoveryNu: vouchers.advanceRecoveryNu,
        advanceRecoveryVoucherId: vouchers.advanceRecoveryVoucherId,
        payrollRunId: vouchers.payrollRunId,
        payrollEntryType: vouchers.payrollEntryType,
      })
      .from(vouchers)
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.fiscalYear, fiscalYear), eq(vouchers.status, "Pending")))
      .for("update")
      .limit(1);

    if (!pending) throw conflict("This voucher is no longer pending approval.");

    if (status === "Approved" && pending.advanceRecoveryNu > 0 && pending.advanceRecoveryVoucherId) {
      const advance = await loadOutstandingAdvance(tx, pending.advanceRecoveryVoucherId, fiscalYear);
      if (!advance || pending.advanceRecoveryNu > advance.outstandingNu) {
        throw conflict(
          "Voucher cannot be approved because the advance recovery is greater than the current outstanding balance.",
          { outstandingAdvanceNu: advance?.outstandingNu ?? 0 },
        );
      }
    }

    const sign = budgetLineSign(pending.voucherType);
    if (status === "Approved" && sign !== 0 && pending.activityId) {
      const lines = await loadBudgetLines(tx, voucherId);
      if (!lines.length) throw conflict("This voucher has no valid budget allocations and cannot be approved.");

      const balances = await loadActivityBalances(
        tx,
        fiscalYear,
        lines.map((line) => line.activityId),
        true,
      );
      assertBudgetLinesFit(lines, balances, sign === 1 ? "spend" : "refund", "cannot be approved");
    }

    const updated = await tx
      .update(vouchers)
      .set({ status, approvedBy: user.id, approvedAt: new Date() })
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.status, "Pending")))
      .returning({ id: vouchers.id });

    if (!updated.length) throw conflict("This voucher is no longer pending approval.");

    await audit(
      user.id,
      `voucher_${status.toLocaleLowerCase()}`,
      "voucher",
      voucherId,
      `${status} by ${user.displayName}`,
      tx,
    );

    return { payrollRunId: pending.payrollRunId, payrollEntryType: pending.payrollEntryType };
  });
}

/**
 * Emails payslips for an approved combined payroll voucher.
 *
 * Runs after the approval commits: a mail provider outage must never roll back
 * an approved voucher. Each employee is marked as sent so a retry cannot
 * double-send, and the Resend idempotency key gives a second layer of safety.
 */
export async function deliverPayslipsForPayrollVoucher(
  user: SessionUser,
  voucherId: number,
  payrollRunId: number,
): Promise<PayslipDelivery> {
  const delivery: PayslipDelivery = { sent: 0, failed: 0, skipped: 0 };

  const [payrollVoucher] = await db
    .select({
      voucherNumber: vouchers.voucherNumber,
      payMonth: payrollRuns.payMonth,
      department: payrollRuns.department,
    })
    .from(vouchers)
    .innerJoin(payrollRuns, eq(payrollRuns.id, vouchers.payrollRunId))
    .where(and(eq(vouchers.id, voucherId), eq(payrollRuns.id, payrollRunId)))
    .limit(1);

  const items = await db
    .select()
    .from(payrollRunItems)
    .where(eq(payrollRunItems.payrollRunId, payrollRunId))
    .orderBy(payrollRunItems.employeeNumber);

  if (!payrollVoucher) {
    delivery.failed = items.length;
    return delivery;
  }

  for (const item of items) {
    const recipient = item.email?.trim().toLocaleLowerCase();
    if (!recipient || item.payslipSentAt || !EMAIL_PATTERN.test(recipient)) {
      delivery.skipped += 1;
      continue;
    }

    try {
      const emailId = await sendPayrollPayslipEmail({
        recipient,
        employeeNumber: item.employeeNumber,
        fullName: item.fullName,
        designation: item.designation,
        department: item.department || payrollVoucher.department,
        payMonth: payrollVoucher.payMonth,
        voucherNumber: payrollVoucher.voucherNumber,
        basicPayNu: item.basicPayNu,
        allowancesNu: item.allowancesNu,
        arrearNu: item.arrearNu,
        grossPayNu: item.grossPayNu,
        taxOnSalaryNu: item.taxOnSalaryNu,
        healthContributionNu: item.healthContributionNu,
        advanceNu: item.advanceNu,
        recoveriesNu: item.recoveriesNu,
        netPayNu: item.netPayNu,
        idempotencyKey: `payroll-payslip-${voucherId}-${item.id}`,
      });

      await db
        .update(payrollRunItems)
        .set({ payslipEmailId: emailId, payslipSentAt: new Date() })
        .where(and(eq(payrollRunItems.id, item.id), isNull(payrollRunItems.payslipSentAt)));
      delivery.sent += 1;
    } catch (error) {
      delivery.failed += 1;
      logger.error(
        { err: error instanceof EmailDeliveryError ? error.message : error, employeeId: item.employeeId },
        "Payroll voucher was approved, but an employee payslip email could not be delivered",
      );
    }
  }

  await audit(
    user.id,
    "payroll_payslips_emailed",
    "payroll_run",
    payrollRunId,
    `${payrollVoucher.payMonth}: ${delivery.sent} sent, ${delivery.failed} failed, ${delivery.skipped} skipped`,
  );

  return delivery;
}

/** Reverses an approved voucher, preserving the original entry for audit. */
export async function reverseVoucher(
  user: SessionUser,
  voucherId: number,
  reversalReason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [voucher] = await tx
      .select({
        id: vouchers.id,
        fiscalYear: vouchers.fiscalYear,
        voucherType: vouchers.voucherType,
        activityId: vouchers.activityId,
        supplierTdsRemittanceRunId: vouchers.supplierTdsRemittanceRunId,
      })
      .from(vouchers)
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.status, "Approved")))
      .for("update")
      .limit(1);

    if (!voucher) throw conflict("Only a currently approved voucher can be reversed.");

    if (!voucher.supplierTdsRemittanceRunId) {
      const [activeRemittance] = await tx.execute<{ id: number; tdsRate: number; payMonth: string }>(raw`
        SELECT remittance.id, remittance.tds_rate AS "tdsRate", remittance.pay_month AS "payMonth"
        FROM supplier_tds_remittance_items item
        JOIN supplier_tds_remittance_runs remittance ON remittance.id = item.remittance_run_id
        WHERE item.voucher_id = ${voucherId} AND remittance.status <> 'Reversed'
        LIMIT 1
      `) as unknown as { id: number; tdsRate: number; payMonth: string }[];

      if (activeRemittance) {
        throw conflict(
          `This supplier voucher is included in the ${activeRemittance.tdsRate}% TDS remittance for ${activeRemittance.payMonth}. Reverse the approved remittance voucher first.`,
        );
      }
    }

    if (voucher.voucherType === "Advance") {
      const [recovery] = await tx.execute<{ recoveredNu: number }>(raw`
        SELECT COALESCE(SUM(advance_recovery_nu), 0) AS "recoveredNu"
        FROM vouchers
        WHERE advance_recovery_voucher_id = ${voucherId} AND status IN ('Approved','Paid')
      `) as unknown as { recoveredNu: number }[];

      if ((recovery?.recoveredNu ?? 0) > 0) {
        throw conflict("Reverse the approved advance recovery vouchers before reversing this advance.");
      }
    }

    // Reversing a refund takes the credited budget back off the activities, so
    // it must still fit inside what is available on each of them now.
    if (budgetLineSign(voucher.voucherType) === -1 && voucher.activityId) {
      const lines = await loadBudgetLines(tx, voucherId);
      const balances = await loadActivityBalances(
        tx,
        voucher.fiscalYear,
        lines.map((line) => line.activityId),
        true,
      );
      assertBudgetLinesFit(lines, balances, "spend", "cannot absorb this refund reversal");
    }

    const reversed = await tx
      .update(vouchers)
      .set({ status: "Reversed", reversedBy: user.id, reversedAt: new Date(), reversalReason })
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.status, "Approved")))
      .returning({ id: vouchers.id });

    if (!reversed.length) throw conflict("Only a currently approved voucher can be reversed.");

    if (voucher.supplierTdsRemittanceRunId) {
      // Reversing the remittance voucher releases its source deductions so
      // they can be scheduled again in a later remittance.
      await tx
        .update(supplierTdsRemittanceRuns)
        .set({ status: "Reversed" })
        .where(eq(supplierTdsRemittanceRuns.id, voucher.supplierTdsRemittanceRunId));
    }

    await audit(
      user.id,
      "voucher_reversed",
      "voucher",
      voucherId,
      `Reversed by ${user.displayName}: ${reversalReason}`,
      tx,
    );
  });
}

async function loadBudgetLines(executor: DbExecutor, voucherId: number): Promise<BudgetLineInput[]> {
  return executor
    .select({ activityId: voucherBudgetLines.activityId, amountNu: voucherBudgetLines.amountNu })
    .from(voucherBudgetLines)
    .where(eq(voucherBudgetLines.voucherId, voucherId));
}

/** Removes generated payroll vouchers that never reached an approved state. */
export async function deleteUnapprovedPayrollVouchers(executor: DbExecutor, payrollRunId: number): Promise<number> {
  const removable = await executor
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(and(eq(vouchers.payrollRunId, payrollRunId), inArray(vouchers.status, ["Draft", "Pending", "Rejected"])));

  if (!removable.length) return 0;
  const ids = removable.map((row) => row.id);
  await executor.delete(voucherBudgetLines).where(inArray(voucherBudgetLines.voucherId, ids));
  await executor.delete(vouchers).where(inArray(vouchers.id, ids));
  return ids.length;
}

export function isDuplicateVoucherNumber(error: unknown): boolean {
  return isPostgresError(error, PG_UNIQUE_VIOLATION);
}
