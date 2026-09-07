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
