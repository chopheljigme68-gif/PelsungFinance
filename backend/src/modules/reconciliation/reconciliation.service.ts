import { and, eq, sql as raw } from "drizzle-orm";
import { db } from "../../db/client.js";
import { bankReconciliationItems, bankReconciliations, monthClosures } from "../../db/schema.js";
import { currentBhutanMonth, monthEndDate, normalizePayMonth } from "../../domain/fiscal-year.js";
import { OPERATING_BANK_ACCOUNT } from "../../domain/reference.js";
import { roundNu } from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, serverError } from "../../lib/errors.js";
import type { SessionUser } from "../auth/auth.service.js";

const MAX_AMOUNT_NU = 1_000_000_000_000;

/** True when the accounting month for this operating account has been closed. */
export async function isAccountingMonthClosed(fiscalYear: string, payMonth: string): Promise<boolean> {
  const [row] = (await db.execute(raw`
    SELECT id FROM month_closures
    WHERE fiscal_year = ${fiscalYear} AND close_month = ${payMonth} AND status = 'Closed'
    LIMIT 1
  `)) as unknown as { id: number }[];
  return Boolean(row);
}

/**
 * The cash-book position for a month, derived from posted vouchers up to the end
 * of that month — the same figures the reconciliation is measured against.
 */
export async function loadCashBookPosition(fiscalYear: string, statementMonth: string) {
  const [row] = (await db.execute(raw`
    SELECT
      COALESCE(SUM(CASE WHEN voucher_type = 'Receipt' THEN amount_nu ELSE 0 END), 0) AS "totalFundsReceivedNu",
      COALESCE(SUM(CASE
        WHEN voucher_type = 'Receipt' THEN amount_nu
        WHEN voucher_type = 'Payment' THEN -COALESCE(NULLIF(net_payment_nu, 0), amount_nu - COALESCE(tds_nu, 0) - COALESCE(advance_recovery_nu, 0))
        WHEN voucher_type = 'Advance' THEN -amount_nu
        ELSE 0 END), 0) AS "closingCashBookBalanceNu"
    FROM vouchers
    WHERE fiscal_year = ${fiscalYear} AND status IN ('Approved', 'Paid') AND transaction_date <= ${monthEndDate(statementMonth)}
  `)) as unknown as { totalFundsReceivedNu: number; closingCashBookBalanceNu: number }[];
  const totalFundsReceivedNu = roundNu(Number(row?.totalFundsReceivedNu ?? 0));
  const closingCashBookBalanceNu = roundNu(Number(row?.closingCashBookBalanceNu ?? 0));
  return {
    totalFundsReceivedNu,
    closingCashBookBalanceNu,
    cashBookWithdrawalsNu: roundNu(totalFundsReceivedNu - closingCashBookBalanceNu),
  };
}

/**
 * Outstanding statutory liabilities for a month: payroll TDS + health
 * contribution withheld on posted pay bills but not yet remitted (no Posted
 * payroll remittance), and supplier TDS withheld on the month's vouchers that
 * has not been remitted. A month cannot be Reconciled while any remains.
 */
export async function loadMonthLiabilities(fiscalYear: string, statementMonth: string) {
  const [payroll] = (await db.execute(raw`
    SELECT
      COALESCE((
        SELECT SUM(tax_on_salary_nu + health_contribution_nu) FROM payroll_runs
        WHERE fiscal_year = ${fiscalYear} AND pay_month = ${statementMonth} AND status = 'Posted'
      ), 0) AS "payrollTdsHcNu",
      EXISTS(
        SELECT 1 FROM payroll_remittance_runs
        WHERE fiscal_year = ${fiscalYear} AND pay_month = ${statementMonth} AND status = 'Posted'
      ) AS "payrollRemitted"
  `)) as unknown as { payrollTdsHcNu: number; payrollRemitted: boolean }[];

  const [supplier] = (await db.execute(raw`
    SELECT COALESCE(SUM(v.tds_nu), 0) AS "supplierTdsNu", COUNT(*)::int AS "count"
    FROM vouchers v
    WHERE v.fiscal_year = ${fiscalYear}
      AND substr(v.transaction_date, 1, 7) = ${statementMonth}
      AND v.voucher_type = 'Payment'
      AND v.status IN ('Approved', 'Paid')
      AND v.tds_nu > 0
      AND NOT EXISTS(
        SELECT 1 FROM supplier_tds_remittance_items sti
        JOIN supplier_tds_remittance_runs r ON r.id = sti.remittance_run_id
        WHERE sti.voucher_id = v.id AND r.status <> 'Reversed'
      )
  `)) as unknown as { supplierTdsNu: number; count: number }[];

  const payrollTdsHcNu = roundNu(Number(payroll?.payrollTdsHcNu ?? 0));
  const payrollRemitted = Boolean(payroll?.payrollRemitted);
  const payrollOutstandingNu = payrollTdsHcNu > 0 && !payrollRemitted ? payrollTdsHcNu : 0;
  const supplierTdsOutstandingNu = roundNu(Number(supplier?.supplierTdsNu ?? 0));
  const supplierTdsOutstandingCount = Number(supplier?.count ?? 0);

  return {
    payrollOutstandingNu,
    supplierTdsOutstandingNu,
    supplierTdsOutstandingCount,
    hasOutstanding: payrollOutstandingNu > 0 || supplierTdsOutstandingCount > 0,
  };
}

export type ReconciliationItemInput = {
  itemType: string;
  transactionDate?: string;
  reference?: string;
  particulars: string;
  amountNu: number;
};

export type SaveBankReconciliationInput = {
  accountNumber: string;
  statementMonth: string;
  bankStatementWithdrawalsNu: number;
  reconcile?: boolean;
  items?: ReconciliationItemInput[];
};

/**
 * Saves a monthly bank reconciliation as a draft, or — when `reconcile` — marks
 * it Reconciled once the difference is zero. A reconciled or closed month can no
 * longer be edited.
 */
export async function saveBankReconciliation(
  actor: SessionUser,
  fiscalYear: string,
  input: SaveBankReconciliationInput,
): Promise<{ actionNotice: string }> {
  const accountNumber = String(input.accountNumber ?? "").trim();
  const statementMonth = normalizePayMonth(input.statementMonth, fiscalYear);
  const bankStatementWithdrawalsNu = roundNu(Number(input.bankStatementWithdrawalsNu));
  const reconcile = input.reconcile === true;
  const rawItems = Array.isArray(input.items) ? input.items : [];

  if (
    accountNumber !== OPERATING_BANK_ACCOUNT ||
    !statementMonth ||
    !Number.isFinite(bankStatementWithdrawalsNu) ||
    bankStatementWithdrawalsNu < 0 ||
    bankStatementWithdrawalsNu > MAX_AMOUNT_NU ||
    rawItems.length > 100
  ) {
    throw badRequest("Select a valid account and financial-year month, then enter a valid bank statement withdrawal amount.");
  }
  if (statementMonth > currentBhutanMonth()) throw conflict("A future month cannot be reconciled.");
  if (await isAccountingMonthClosed(fiscalYear, statementMonth)) {
    throw conflict("A bank reconciliation cannot be changed after the accounting month is closed.");
  }

  const items = rawItems.map((rawItem) => ({
    itemType: String(rawItem.itemType ?? ""),
    transactionDate: String(rawItem.transactionDate ?? "").trim(),
    reference: String(rawItem.reference ?? "").trim(),
    particulars: String(rawItem.particulars ?? "").trim(),
    amountNu: roundNu(Number(rawItem.amountNu)),
  }));
  const invalidItem = items.find(
    (item) =>
      !["add", "less"].includes(item.itemType) ||
      !item.particulars ||
      item.particulars.length > 240 ||
      item.reference.length > 80 ||
      (item.transactionDate && !/^20\d{2}-\d{2}-\d{2}$/.test(item.transactionDate)) ||
      !Number.isFinite(item.amountNu) ||
      item.amountNu <= 0 ||
      item.amountNu > MAX_AMOUNT_NU,
  );
  if (invalidItem) throw badRequest("Each Annex entry requires valid particulars and a positive amount.");

  const cashBook = await loadCashBookPosition(fiscalYear, statementMonth);
  const additionsNu = roundNu(items.filter((i) => i.itemType === "add").reduce((s, i) => s + i.amountNu, 0));
  const deductionsNu = roundNu(items.filter((i) => i.itemType === "less").reduce((s, i) => s + i.amountNu, 0));
  const reconciliationTotalNu = roundNu(bankStatementWithdrawalsNu + additionsNu - deductionsNu);
  const differenceNu = roundNu(cashBook.cashBookWithdrawalsNu - reconciliationTotalNu);

  if (reconcile && differenceNu !== 0) {
    throw conflict("The statement cannot be reconciled until the difference is zero.", { differenceNu });
  }

  // All statutory liabilities for the month must be paid off before reconciling.
  if (reconcile) {
    const liabilities = await loadMonthLiabilities(fiscalYear, statementMonth);
    if (liabilities.hasOutstanding) {
      const parts = [
        liabilities.payrollOutstandingNu > 0
          ? `remit payroll TDS & health contribution of Nu. ${liabilities.payrollOutstandingNu.toFixed(2)}`
          : "",
        liabilities.supplierTdsOutstandingCount > 0
          ? `remit supplier TDS on ${liabilities.supplierTdsOutstandingCount} voucher${liabilities.supplierTdsOutstandingCount === 1 ? "" : "s"} (Nu. ${liabilities.supplierTdsOutstandingNu.toFixed(2)})`
          : "",
      ].filter(Boolean);
      throw conflict(`The statement cannot be reconciled until all liabilities are paid off: ${parts.join("; ")}.`, {
        payrollOutstandingNu: liabilities.payrollOutstandingNu,
        supplierTdsOutstandingNu: liabilities.supplierTdsOutstandingNu,
        supplierTdsOutstandingCount: liabilities.supplierTdsOutstandingCount,
      });
    }
  }

  const savedId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: bankReconciliations.id, status: bankReconciliations.status })
      .from(bankReconciliations)
      .where(
        and(
          eq(bankReconciliations.fiscalYear, fiscalYear),
          eq(bankReconciliations.accountNumber, accountNumber),
          eq(bankReconciliations.statementMonth, statementMonth),
        ),
      )
      .limit(1);
    if (existing && ["Reconciled", "Closed"].includes(existing.status)) {
      throw conflict("This statement is already reconciled.");
    }

    const now = new Date();
    const status = reconcile ? "Reconciled" : "Draft";
    const values = {
      totalFundsReceivedNu: cashBook.totalFundsReceivedNu,
      closingCashBookBalanceNu: cashBook.closingCashBookBalanceNu,
      cashBookWithdrawalsNu: cashBook.cashBookWithdrawalsNu,
      bankStatementWithdrawalsNu,
      additionsNu,
      deductionsNu,
      reconciliationTotalNu,
      differenceNu,
      status,
      updatedBy: actor.id,
      updatedAt: now,
      closedBy: reconcile ? actor.id : null,
      closedAt: reconcile ? now : null,
    };

    let reconciliationId: number;
    if (existing) {
      await tx.update(bankReconciliations).set(values).where(eq(bankReconciliations.id, existing.id));
      reconciliationId = existing.id;
    } else {
      const [created] = await tx
        .insert(bankReconciliations)
        .values({
          fiscalYear,
          accountNumber,
          statementMonth,
          preparedBy: actor.id,
          preparedAt: now,
          ...values,
        })
        .returning({ id: bankReconciliations.id });
      reconciliationId = created.id;
    }

    await tx.delete(bankReconciliationItems).where(eq(bankReconciliationItems.reconciliationId, reconciliationId));
    if (items.length) {
      await tx.insert(bankReconciliationItems).values(
        items.map((item) => ({
          reconciliationId,
          itemType: item.itemType,
          transactionDate: item.transactionDate || null,
          reference: item.reference,
          particulars: item.particulars,
          amountNu: item.amountNu,
          createdAt: now,
        })),
      );
    }
    return reconciliationId;
  });

  if (!savedId) throw serverError("The reconciliation could not be saved.");
  await audit(
    actor.id,
    reconcile ? "bank_reconciliation_completed" : "bank_reconciliation_saved",
    "bank_reconciliation",
    savedId,
    `${fiscalYear} ${statementMonth}; ${accountNumber}; difference Nu. ${differenceNu}`,
  );
  return {
    actionNotice: reconcile
      ? `${statementMonth} bank reconciliation was completed successfully.`
      : `${statementMonth} bank reconciliation was saved as a draft.`,
  };
}

/** Closes an accounting month once reconciliation, vouchers and payroll controls pass. */
export async function closeMonth(
  actor: SessionUser,
  fiscalYear: string,
  input: { accountNumber: string; closeMonth: string },
): Promise<{ actionNotice: string }> {
  const accountNumber = String(input.accountNumber ?? "").trim();
  const closeMonth = normalizePayMonth(input.closeMonth, fiscalYear);
  if (accountNumber !== OPERATING_BANK_ACCOUNT || !closeMonth) {
    throw badRequest("Select a valid account and financial-year month.");
  }
  if (closeMonth > currentBhutanMonth()) throw conflict("A future month cannot be closed.");

  const [existingClosure] = (await db.execute(raw`
    SELECT id FROM month_closures
    WHERE fiscal_year = ${fiscalYear} AND account_number = ${accountNumber} AND close_month = ${closeMonth} AND status = 'Closed'
    LIMIT 1
  `)) as unknown as { id: number }[];
  if (existingClosure) throw conflict("This accounting month is already closed.");

  const [reconciliation] = (await db.execute(raw`
    SELECT id FROM bank_reconciliations
    WHERE fiscal_year = ${fiscalYear} AND account_number = ${accountNumber} AND statement_month = ${closeMonth}
      AND status IN ('Reconciled', 'Closed') AND difference_nu = 0
    LIMIT 1
  `)) as unknown as { id: number }[];

  const [pendingVouchers] = (await db.execute(raw`
    SELECT COUNT(*)::int AS count FROM vouchers
    WHERE fiscal_year = ${fiscalYear} AND substr(transaction_date, 1, 7) = ${closeMonth} AND status IN ('Draft', 'Pending')
  `)) as unknown as { count: number }[];

  const [pendingPayroll] = (await db.execute(raw`
    SELECT COUNT(*)::int AS count FROM payroll_runs
    WHERE fiscal_year = ${fiscalYear} AND pay_month = ${closeMonth} AND status = 'Finalized'
  `)) as unknown as { count: number }[];

  const pendingVoucherCount = Number(pendingVouchers?.count ?? 0);
  const pendingPayBillPostingCount = Number(pendingPayroll?.count ?? 0);
  const unmet = [
    !reconciliation ? "complete the monthly bank reconciliation" : "",
    pendingVoucherCount ? `clear ${pendingVoucherCount} pending or draft voucher${pendingVoucherCount === 1 ? "" : "s"}` : "",
    pendingPayBillPostingCount ? `complete ${pendingPayBillPostingCount} pending pay bill posting${pendingPayBillPostingCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  if (unmet.length) {
    throw conflict(`Month Close is blocked: ${unmet.join("; ")}.`, {
      pendingVoucherCount,
      pendingPayBillPostingCount,
      reconciliationCompleted: Boolean(reconciliation),
    });
  }

  const [created] = await db
    .insert(monthClosures)
    .values({ fiscalYear, accountNumber, closeMonth, status: "Closed", closedBy: actor.id, closedAt: new Date() })
    .returning({ id: monthClosures.id });

  await audit(
    actor.id,
    "month_closed",
    "month_closure",
    created.id,
    `${closeMonth}; ${accountNumber}; reconciliation complete; no pending vouchers; no pending pay bill posting`,
  );
  return { actionNotice: `${closeMonth} was closed successfully.` };
}
