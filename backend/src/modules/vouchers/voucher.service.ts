import { and, eq, inArray, isNull, sql as raw } from "drizzle-orm";
import { db, type DbExecutor } from "../../db/client.js";
import { payrollRunItems, payrollRuns, supplierTdsRemittanceRuns, voucherBudgetLines, vouchers } from "../../db/schema.js";
import {
  EMAIL_PATTERN,
  TPN_PATTERN,
  calculateVoucherDeductions,
  formatVoucherNumber,
  roundNu,
  type VoucherStatus,
  type VoucherType,
} from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { EmailDeliveryError, sendPayrollPayslipEmail } from "../../lib/email.js";
import { PG_UNIQUE_VIOLATION, badRequest, conflict, forbidden, isPostgresError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { loadActivityBalances, loadOutstandingAdvance, nextVoucherSerial } from "../accounting/accounting.service.js";
import type { PayslipDelivery } from "../accounting/accounting.types.js";
import { can, type SessionUser } from "../auth/auth.service.js";

export type BudgetLineInput = { activityId: number; amountNu: number };

export type CreateVoucherInput = {
  voucherType: VoucherType;
  payee: string;
  tpn?: string | null;
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
};

/**
 * Creates a Pending voucher.
 *
 * Payments and journals must be allocated across one or more approved budget
 * activities, and the sum of those allocations *is* the voucher amount.
 * Advances and fund receipts carry no budget impact at all.
 */
export async function createVoucher(
  user: SessionUser,
  fiscalYear: string,
  input: CreateVoucherInput,
): Promise<{ voucherNumber: string }> {
  const isFundReceipt = input.voucherType === "Receipt";
  const isAdvance = input.voucherType === "Advance";
  const isPayment = input.voucherType === "Payment";
  const hasNoBudgetImpact = isAdvance || isFundReceipt;

  if (isFundReceipt ? !can(user, "record_fund_receipt") : !can(user, "create_voucher")) throw forbidden();

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
      throw badRequest("Select an approved budget activity and enter a positive amount for every allocation line.");
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

  const voucherNumber = await db.transaction(async (tx) => {
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
      for (const line of budgetLines) {
        const balance = balances.get(line.activityId);
        if (!balance) throw conflict("One of the selected budget activities was not found in this financial year.");
        if (line.amountNu > balance.availableNu) {
          throw conflict(
            `${balance.obc} · ${balance.activity} cannot accept this allocation because it is greater than the available balance.`,
            { availableBalanceNu: balance.availableNu, expenditureAmountNu: line.amountNu },
          );
        }
      }
    }

    const monthKey = input.transactionDate.slice(5, 7);
    const serial = await nextVoucherSerial(tx, fiscalYear, input.voucherType, monthKey);
    const number = formatVoucherNumber(input.voucherType, Number(monthKey), serial);

    const [voucher] = await tx
      .insert(vouchers)
      .values({
        voucherNumber: number,
        activityId: hasNoBudgetImpact ? null : budgetLines[0]?.activityId ?? null,
        fiscalYear,
        voucherType: input.voucherType,
        payee: input.payee,
        tpn: requiresTpn ? tpn : null,
        billReference: input.billReference?.trim() || null,
        description: input.description,
        amountNu,
        gstNu,
        tdsRate,
        tdsNu,
        advanceRecoveryNu,
        advanceRecoveryVoucherId,
        netPaymentNu,
        status: "Pending",
        transactionDate: input.transactionDate,
        createdBy: user.id,
      })
      .returning({ id: vouchers.id, voucherNumber: vouchers.voucherNumber });

    if (budgetLines.length) {
      await tx.insert(voucherBudgetLines).values(
        budgetLines.map((line) => ({ voucherId: voucher.id, activityId: line.activityId, amountNu: line.amountNu })),
      );
    }

    await audit(
      user.id,
      "voucher_created",
      "voucher",
      voucher.voucherNumber,
      `${input.voucherType} voucher: ${budgetLines.length} budget allocation(s), gross Nu. ${amountNu}, TDS Nu. ${tdsNu}, advance recovery Nu. ${advanceRecoveryNu}, net Nu. ${netPaymentNu}`,
      tx,
    );

    return voucher.voucherNumber;
  });

  return { voucherNumber };
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

    if (status === "Approved" && pending.voucherType !== "Advance" && pending.activityId) {
      const lines = await tx
        .select({ activityId: voucherBudgetLines.activityId, amountNu: voucherBudgetLines.amountNu })
        .from(voucherBudgetLines)
        .where(eq(voucherBudgetLines.voucherId, voucherId));

      if (!lines.length) throw conflict("This voucher has no valid budget allocations and cannot be approved.");

      const balances = await loadActivityBalances(
        tx,
        fiscalYear,
        lines.map((line) => line.activityId),
        true,
      );
      for (const line of lines) {
        const balance = balances.get(line.activityId);
        if (!balance) throw conflict("This voucher has no valid budget allocations and cannot be approved.");
        if (line.amountNu > balance.availableNu) {
          throw conflict(
            `${balance.obc} · ${balance.activity} cannot be approved because its allocation is greater than the available balance.`,
            { availableBalanceNu: balance.availableNu, expenditureAmountNu: line.amountNu },
          );
        }
      }
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
        voucherType: vouchers.voucherType,
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