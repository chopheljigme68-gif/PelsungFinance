/**
 * Bhutan's financial year runs 1 July to 30 June.
 *
 * Mirrored in `frontend/src/lib/fiscal-year.ts`.
 */

export const DEFAULT_FISCAL_YEAR = "2026-2027";
export const BASE_FISCAL_YEARS = ["2025-2026", DEFAULT_FISCAL_YEAR, "2027-2028"] as const;

const FISCAL_YEAR_PATTERN = /^(20\d{2})-(20\d{2})$/;

export function isFiscalYear(value: unknown): value is string {
  const match = FISCAL_YEAR_PATTERN.exec(String(value ?? ""));
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

/** Falls back to the default year rather than throwing, matching the UI contract. */
export function normalizeFiscalYear(value: unknown): string {
  return isFiscalYear(value) ? String(value) : DEFAULT_FISCAL_YEAR;
}

/** The twelve `YYYY-MM` pay months of a fiscal year, July first. */
export function fiscalYearMonths(fiscalYear: string): string[] {
  const startYear = Number(fiscalYear.slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => {
    const monthIndex = index + 6;
    const year = startYear + Math.floor(monthIndex / 12);
    return `${year}-${String((monthIndex % 12) + 1).padStart(2, "0")}`;
  });
}

export function isPayMonthInFiscalYear(payMonth: unknown, fiscalYear: string): payMonth is string {
  return fiscalYearMonths(fiscalYear).includes(String(payMonth ?? ""));
}

export function normalizePayMonth(value: unknown, fiscalYear: string): string | null {
  const payMonth = String(value ?? "");
  return isPayMonthInFiscalYear(payMonth, fiscalYear) ? payMonth : null;
}

export function fiscalYearStartDate(fiscalYear: string): string {
  return `${fiscalYear.slice(0, 4)}-07-01`;
}

export function fiscalYearEndDate(fiscalYear: string): string {
  return `${Number(fiscalYear.slice(0, 4)) + 1}-06-30`;
}

/** Last calendar date of a `YYYY-MM` month, e.g. `2026-07` → `2026-07-31`. */
export function monthEndDate(payMonth: string): string {
  const [year, month] = payMonth.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${payMonth}-${String(day).padStart(2, "0")}`;
}

const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function monthCode(payMonth: string): string {
  const month = Number(payMonth.slice(5, 7));
  return MONTH_CODES[month - 1] ?? "";
}

/** `Finance and Accounts` → `FAA`; used in pay bill references. */
export function departmentCode(department: string): string {
  const initials = department
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .replace(/[^A-Z0-9]/gi, "")
    .toLocaleUpperCase();
  return initials || department.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toLocaleUpperCase() || "DEPT";
}

export function payBillReference(payMonth: string, department: string): string {
  return `PB-${monthCode(payMonth)}-${payMonth.slice(0, 4)}-${departmentCode(department)}`;
}

export function payrollRemittanceReference(payMonth: string): string {
  return `TDSHC-${monthCode(payMonth)}-${payMonth.slice(0, 4)}`;
}

export function supplierTdsReference(payMonth: string, tdsRate: number): string {
  return `SUP-TDS-${tdsRate}-${monthCode(payMonth)}-${payMonth.slice(0, 4)}`;
}
