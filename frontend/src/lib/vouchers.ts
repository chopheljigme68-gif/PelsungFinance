/**
 * Voucher arithmetic and vocabulary shared by the API and the UI.
 *
 * Mirrored in `backend/src/domain/vouchers.ts`.
 */

export const VOUCHER_TDS_RATES = [0, 2, 5] as const;
export type VoucherTdsRate = (typeof VOUCHER_TDS_RATES)[number];

export const VOUCHER_TYPES = ["Payment", "Journal", "Receipt", "Advance"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

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

type BankEffectVoucher = {
  voucherType: string;
  amountNu: number;
  netPaymentNu: number;
};

/** Signed effect of a posted voucher on the operating bank account. */
export function voucherBankEffectNu(voucher: BankEffectVoucher): number {
  if (voucher.voucherType === "Receipt") return voucher.amountNu;
  if (voucher.voucherType === "Payment") return -voucher.netPaymentNu;
  if (voucher.voucherType === "Advance") return -voucher.amountNu;
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
  const tdsBasisNu = Math.max(grossNu - gstNu, 0);
  const tdsNu = Math.round((tdsBasisNu * tdsRate) / 100);
  const netPaymentNu = grossNu - tdsNu - advanceRecoveryNu;
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
