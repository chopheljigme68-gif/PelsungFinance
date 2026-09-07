/**
 * Reference lists for dropdowns. Mirror of backend `src/domain/reference.ts` —
 * keep the two in sync.
 */

/** Programmes a budget activity and a voucher belong to (the report groups). */
export const PROGRAMS = [
  "Stipend for Three Cohorts",
  "Innovation Lab",
  "Operations & Partnerships",
  "Secretariat Services",
  "Alumni Engagement & Outreach",
  "Strategic Flexibility Reserve",
] as const;

export type Program = (typeof PROGRAMS)[number];

/** Banks an employee's salary account can be held at. */
export const BANKS = [
  "Bank of Bhutan",
  "Bhutan National Bank",
  "Punjab National Bank",
  "Digital Kidu",
] as const;

export type Bank = (typeof BANKS)[number];

/** Pelsung's single operating bank account, reconciled and closed each month. */
export const OPERATING_BANK_ACCOUNT = "110116024748";
