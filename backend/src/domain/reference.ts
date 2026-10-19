/**
 * Reference lists shared by the API and the UI.
 *
 * Kept here (in the pure domain layer) so the same values drive server-side
 * validation and the frontend dropdowns — the client mirror in
 * `frontend/src/lib/reference.ts` must match this file.
 */

/**
 * Programmes the agency budgets and spends under. These are the "programs" the
 * reports group by; a budget activity and a voucher both belong to one.
 */
export const PROGRAMS = [
  "Stipend for Three Cohorts",
  "Innovation Lab",
  "Operations & Partnerships",
  "Secretariat Services",
  "Alumni Engagement & Outreach",
  "Strategic Flexibility Reserve",
] as const;

export type Program = (typeof PROGRAMS)[number];

export function isProgram(value: string): value is Program {
  return (PROGRAMS as readonly string[]).includes(value);
}

/** Banks an employee's salary account can be held at. */
export const BANKS = [
  "Bank of Bhutan",
  "Bhutan National Bank",
  "Punjab National Bank",
  "Digital Kidu",
] as const;

export type Bank = (typeof BANKS)[number];

export function isBank(value: string): value is Bank {
  return (BANKS as readonly string[]).includes(value);
}

/** The single operating bank account the system reconciles and closes against. */
export const OPERATING_BANK_ACCOUNT = "110116024748";

export type LedgerKind = "bank" | "cash";

export type LedgerAccount = {
  /** Chart-of-accounts code; stored on the voucher as `ledger_code`. */
  code: string;
  kind: LedgerKind;
  name: string;
  accountNumber: string | null;
  bankName: string | null;
};

export const BANK_LEDGER_CODE = "1001";
export const CASH_LEDGER_CODE = "1002";

/**
 * The money ledgers a voucher can move. Receipts land in a bank or the cash
 * ledger; a direct transaction (DT) names the bank ledger it went through. To
 * add a second bank account, add it here (both copies) and widen the
 * `vouchers_ledger_code_check` constraint in a migration.
 */
export const LEDGER_ACCOUNTS: readonly LedgerAccount[] = [
  {
    code: BANK_LEDGER_CODE,
    kind: "bank",
    name: "Pelsung Operating Account",
    accountNumber: OPERATING_BANK_ACCOUNT,
    bankName: "Bank of Bhutan",
  },
  { code: CASH_LEDGER_CODE, kind: "cash", name: "Cash in Hand", accountNumber: null, bankName: null },
];

export function findLedger(code: string | null | undefined): LedgerAccount | undefined {
  return LEDGER_ACCOUNTS.find((ledger) => ledger.code === (code ?? BANK_LEDGER_CODE));
}

export function isBankLedger(code: string | null | undefined): boolean {
  return findLedger(code)?.kind === "bank";
}
