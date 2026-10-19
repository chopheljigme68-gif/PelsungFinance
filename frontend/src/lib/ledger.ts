import { findLedger } from "@/lib/reference";
import type { Voucher } from "@/types";

export type LedgerRow = {
  key: string;
  date: string;
  reference: string;
  account: string;
  particulars: string;
  debitNu: number | null;
  creditNu: number | null;
  reversal?: boolean;
};

/** Clearing account for direct transactions (DT): booked by the bank, not through the cash book. */
export const DIRECT_TRANSACTION_ACCOUNT = "2201 · Direct Bank Transactions";

/** `1001 · Bank` / `1002 · Cash in Hand` — the ledger line a voucher's money moves through. */
export function ledgerAccountName(ledgerCode: string | null | undefined): string {
  const ledger = findLedger(ledgerCode);
  if (!ledger) return "1001 · Bank";
  return ledger.kind === "bank" ? `${ledger.code} · Bank` : `${ledger.code} · ${ledger.name}`;
}

/**
 * Expands one posted voucher into its double-entry lines.
 *
 * Payroll and remittance vouchers post to control accounts rather than the
 * bank alone, so each entry type has its own pattern. A reversed voucher keeps
 * its original lines and gains a mirrored set dated at the reversal — the
 * ledger never edits history.
 */
export function ledgerRowsForVoucher(voucher: Voucher): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const addRow = (
    suffix: string,
    account: string,
    particulars: string,
    debitNu: number | null,
    creditNu: number | null,
  ) =>
    rows.push({
      key: `${voucher.id}-${suffix}`,
      date: voucher.transactionDate,
      reference: voucher.voucherNumber,
      account,
      particulars,
      debitNu,
      creditNu,
    });

  if (voucher.payrollEntryType === "combined") {
    addRow("payroll-expense-debit", `${voucher.obc} · ${voucher.activity}`, voucher.description, voucher.amountNu, null);
    if (voucher.tdsNu > 0) addRow("salary-tds-credit", "2102 · Salary TDS Payable", "Salary TDS withheld", null, voucher.tdsNu);
    if (voucher.payrollHealthContributionNu > 0) {
      addRow(
        "health-contribution-credit",
        "2103 · Health Contribution Payable",
        "Health Contribution withheld",
        null,
        voucher.payrollHealthContributionNu,
      );
    }
    if (voucher.advanceRecoveryNu > 0) {
      addRow(
        "salary-advance-credit",
        "1102 · Employee Advance Receivable",
        "Employee advance recovered from salary",
        null,
        voucher.advanceRecoveryNu,
      );
    }
    addRow("bank-credit", "1001 · Bank", "Net salary transferred to employees", null, voucher.netPaymentNu);
  } else if (voucher.payrollEntryType === "gross") {
    addRow("payroll-expense-debit", `${voucher.obc} · ${voucher.activity}`, voucher.description, voucher.amountNu, null);
    addRow("payroll-clearing-credit", "2105 · Payroll Clearing", "Gross payroll transferred to payroll control", null, voucher.amountNu);
  } else if (voucher.payrollEntryType === "recoveries") {
    addRow("payroll-clearing-debit", "2105 · Payroll Clearing", voucher.description, voucher.amountNu, null);
    addRow(
      "payroll-recoveries-credit",
      "2106 · Payroll Recoveries Payable",
      "Salary tax, health contribution and advance recoveries",
      null,
      voucher.amountNu,
    );
  } else if (voucher.payrollEntryType === "net") {
    addRow("payroll-clearing-debit", "2105 · Payroll Clearing", voucher.description, voucher.amountNu, null);
    addRow("bank-credit", "1001 · Bank", "Net salary transferred to employees", null, voucher.amountNu);
  } else if (voucher.payrollEntryType === "tds_hc_remittance") {
    if (voucher.tdsNu > 0) {
      addRow("salary-tds-payable-debit", "2102 · Salary TDS Payable", "Salary TDS remitted", voucher.tdsNu, null);
    }
    if (voucher.payrollHealthContributionNu > 0) {
      addRow(
        "health-contribution-payable-debit",
        "2103 · Health Contribution Payable",
        "Health Contribution remitted",
        voucher.payrollHealthContributionNu,
        null,
      );
    }
    if (voucher.tdsNu === 0 && voucher.payrollHealthContributionNu === 0) {
      addRow("remittance-payable-debit", "2106 · Payroll Recoveries Payable", voucher.description, voucher.amountNu, null);
    }
    addRow("bank-credit", "1001 · Bank", "TDS and Health Contribution remitted", null, voucher.amountNu);
  } else if (voucher.payrollEntryType === "supplier_tds_remittance") {
    addRow(
      "supplier-tds-payable-debit",
      `2102 · ${voucher.supplierTdsRate}% Supplier TDS Payable`,
      `${voucher.supplierTdsRate}% supplier TDS remitted`,
      voucher.amountNu,
      null,
    );
    addRow("bank-credit", "1001 · Bank", "TDS remitted to the Department of Revenue and Customs", null, voucher.amountNu);
  } else if (voucher.voucherType === "Receipt") {
    // Money lands in the bank or cash ledger; a refund credits the activities
    // it was originally charged to, anything else credits a receipts account.
    addRow("ledger-debit", ledgerAccountName(voucher.ledgerCode), voucher.payee, voucher.amountNu, null);
    if (voucher.budgetLines.length) {
      voucher.budgetLines.forEach((line) =>
        addRow(`refund-credit-${line.id}`, `${line.obc} · ${line.activity}`, `Refund: ${voucher.description}`, null, line.amountNu),
      );
    } else {
      addRow(
        "income-credit",
        voucher.receiptCategory === "Other receipt"
          ? `3002 · Other Receipts from ${voucher.payee}`
          : `3001 · Fund Received from ${voucher.payee}`,
        voucher.description,
        null,
        voucher.amountNu,
      );
    }
  } else if (voucher.voucherType === "DT") {
    // The bank moved the money directly, so the system bank balance is left
    // alone: the expenditure is cleared through the direct-transaction account.
    voucher.budgetLines.forEach((line) =>
      addRow(`expense-debit-${line.id}`, `${line.obc} · ${line.activity}`, voucher.description, line.amountNu, null),
    );
    addRow(
      "direct-credit",
      DIRECT_TRANSACTION_ACCOUNT,
      `${voucher.payee} · via ${ledgerAccountName(voucher.ledgerCode)}`,
      null,
      voucher.amountNu,
    );
  } else if (voucher.voucherType === "Advance") {
    addRow("advance-debit", "1102 · Advance Receivable", voucher.description, voucher.amountNu, null);
    addRow("bank-credit", "1001 · Bank", voucher.payee, null, voucher.amountNu);
  } else {
    const allocations = voucher.budgetLines.length
      ? voucher.budgetLines
      : [{ id: 0, obc: voucher.obc, activity: voucher.activity, amountNu: voucher.amountNu }];
    allocations.forEach((line, index) =>
      addRow(`expense-debit-${line.id || index}`, `${line.obc} · ${line.activity}`, voucher.description, line.amountNu, null),
    );
    if (voucher.tdsNu > 0) {
      addRow("tds-credit", `2102 · ${voucher.tdsRate}% TDS Payable`, `TDS withheld from ${voucher.payee}`, null, voucher.tdsNu);
    }
    if (voucher.advanceRecoveryNu > 0) {
      addRow(
        "recovery-credit",
        "1102 · Advance Receivable",
        `Recovery against ${voucher.advanceRecoveryVoucherNumber ?? "outstanding advance"}`,
        null,
        voucher.advanceRecoveryNu,
      );
    }
    addRow(
      "bank-credit",
      "1001 · Bank",
      voucher.payee,
      null,
      voucher.voucherType === "Payment" ? voucher.netPaymentNu : voucher.amountNu,
    );
  }

  if (voucher.status !== "Reversed") return rows;

  const reversalDate = voucher.reversedAt?.slice(0, 10) ?? voucher.transactionDate;
  return [
    ...rows,
    ...rows.map((row) => ({
      ...row,
      key: `${row.key}-reversal`,
      date: reversalDate,
      reference: `${voucher.voucherNumber} · REV`,
      particulars: `Reversal: ${voucher.reversalReason}`,
      debitNu: row.creditNu,
      creditNu: row.debitNu,
      reversal: true,
    })),
  ];
}
