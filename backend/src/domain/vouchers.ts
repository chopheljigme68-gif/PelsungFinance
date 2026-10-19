/**
 * Voucher arithmetic and vocabulary shared by the API and the UI.
 *
 * Mirrored in `frontend/src/lib/vouchers.ts`.
 */

import { isBankLedger } from "./reference.js";

/** Rounds a Ngultrum amount to 2 decimal places (chhertum). */
export function roundNu(amountNu: number): number {
  return Math.round((amountNu + Number.EPSILON) * 100) / 100;
}

export const VOUCHER_TDS_RATES = [0, 2, 5] as const;
export type VoucherTdsRate = (typeof VOUCHER_TDS_RATES)[number];

export const VOUCHER_TYPES = ["Payment", "Journal", "Receipt", "Advance", "DT"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

/**
 * What a Receipt voucher records. Only a refund touches the budget: it credits
 * the expenditure back to the activities it was charged to, raising their
 * available balance. Fund and other receipts carry no budget line.
 */
export const RECEIPT_CATEGORIES = ["Fund receipt", "Refund", "Other receipt"] as const;
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

export function receiptCreditsBudget(category: string | null | undefined): boolean {
  return category === "Refund";
}

/**
 * How a posted voucher's budget lines move an activity's committed amount:
 * +1 spends it, −1 gives it back (a refund receipt), 0 never touches it.
 * Mirrored in SQL as `SIGNED_BUDGET_LINE` in the accounting service.
 */
export function budgetLineSign(voucherType: string): 1 | -1 | 0 {
  if (voucherType === "Receipt") return -1;
  if (voucherType === "Advance") return 0;
  return 1;
}

export const VOUCHER_STATUSES = ["Draft", "Pending", "Approved", "Paid", "Rejected", "Reversed"] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export const PAYROLL_ENTRY_TYPES = [
  "gross",
  "recoveries",
  "net",
  "combined",
  "tds_hc_remittance",
  "supplier_tds_remittance",
] as const;
export type PayrollEntryType = (typeof PAYROLL_ENTRY_TYPES)[number];

/** Statuses that commit budget and move the bank position. */
export const POSTED_STATUSES: VoucherStatus[] = ["Approved", "Paid"];

export function isPostedStatus(status: string): boolean {
  return POSTED_STATUSES.includes(status as VoucherStatus);
}

type LedgerEffectVoucher = {
  voucherType: string;
  amountNu: number;
  netPaymentNu: number;
  ledgerCode?: string | null;
};

/**
 * Signed effect of a posted voucher on the operating bank account. A receipt
 * into cash and a direct transaction (DT) leave the bank untouched; journals
 * never move money.
 */
export function voucherBankEffectNu(voucher: LedgerEffectVoucher): number {
  if (voucher.voucherType === "Receipt") return isBankLedger(voucher.ledgerCode) ? voucher.amountNu : 0;
  if (voucher.voucherType === "Payment") return -voucher.netPaymentNu;
  if (voucher.voucherType === "Advance") return -voucher.amountNu;
  return 0;
}

/** Signed effect of a posted voucher on cash in hand (only cash receipts today). */
export function voucherCashEffectNu(voucher: LedgerEffectVoucher): number {
  if (voucher.voucherType === "Receipt" && !isBankLedger(voucher.ledgerCode)) return voucher.amountNu;
  return 0;
}

/**
 * TDS is charged on the gross amount less any GST included in it; the net
 * payment is the gross less TDS less any advance recovered on the same bill.
 */
export function calculateVoucherDeductions(
  grossNu: number,
  gstNu: number,
  tdsRate: number,
  advanceRecoveryNu: number,
) {
  const tdsBasisNu = roundNu(Math.max(grossNu - gstNu, 0));
  const tdsNu = roundNu((tdsBasisNu * tdsRate) / 100);
  const netPaymentNu = roundNu(grossNu - tdsNu - advanceRecoveryNu);
  return { tdsBasisNu, tdsNu, netPaymentNu };
}

/** `PV.7.01` — prefix, fiscal-month number, then a two-digit serial. */
export function voucherNumberPrefix(voucherType: VoucherType): string {
  switch (voucherType) {
    case "Journal":
      return "JV";
    case "Receipt":
      return "RV";
    case "Advance":
      return "AV";
    case "DT":
      return "DT";
    default:
      return "PV";
  }
}

export function formatVoucherNumber(voucherType: VoucherType, monthNumber: number, serial: number): string {
  return `${voucherNumberPrefix(voucherType)}.${monthNumber}.${String(serial).padStart(2, "0")}`;
}

/** Highest trailing serial across a set of voucher numbers, or 0. */
export function highestVoucherSerial(voucherNumbers: string[]): number {
  return voucherNumbers.reduce((highest, voucherNumber) => {
    const serial = Number(voucherNumber.split(".").at(-1)) || 0;
    return Math.max(highest, serial);
  }, 0);
}

export const TPN_PATTERN = /^[A-Z0-9][A-Z0-9./-]*$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
export const CID_PATTERN = /^\d{11}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Nu. 1 trillion — the largest amount any single record may carry. */
export const MAX_AMOUNT_NU = 1_000_000_000_000;