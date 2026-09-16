/** Display formatting for Ngultrum amounts, dates and voucher wording. */

// Ngultrum carry 2 decimal places (chhertum), so amounts always show them.
const amountNumber = new Intl.NumberFormat("en-BT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rounds a Ngultrum amount to 2 decimal places. */
export const roundNu = (value: number): number => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

export const money = {
  format: (value: number) => `Nu. ${amountNumber.format(roundNu(value))}`,
};

export const scheduleNumber = new Intl.NumberFormat("en-BT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const numberToWords = (value: number): string => {
  const ones = [
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const wholeNumber = Math.round(value);

  const underThousand = (amount: number): string => {
    if (amount < 20) return ones[amount];
    if (amount < 100) return `${tens[Math.floor(amount / 10)]}${amount % 10 ? `-${ones[amount % 10]}` : ""}`;
    return `${ones[Math.floor(amount / 100)]} Hundred${amount % 100 ? ` ${underThousand(amount % 100)}` : ""}`;
  };

  if (wholeNumber === 0) return ones[0];
  if (wholeNumber < 0) return `Minus ${numberToWords(Math.abs(wholeNumber))}`;

  const groups = [
    { amount: 1_000_000_000, label: "Billion" },
    { amount: 1_000_000, label: "Million" },
    { amount: 1_000, label: "Thousand" },
  ];
  let remainder = wholeNumber;
  const words: string[] = [];
  for (const group of groups) {
    if (remainder >= group.amount) {
      words.push(`${numberToWords(Math.floor(remainder / group.amount))} ${group.label}`);
      remainder %= group.amount;
    }
  }
  if (remainder) words.push(underThousand(remainder));
  return words.join(" ");
};

export const ngultrumInWords = (value: number) => `Ngultrum ${numberToWords(value)} Only`;

/** Amount in words including chhertum, e.g. "Ngultrum One Thousand and Fifty Chhertum Only". */
export const voucherAmountInWords = (value: number) => {
  const rounded = roundNu(value);
  const whole = Math.floor(Math.abs(rounded));
  const chhertum = Math.round((Math.abs(rounded) - whole) * 100);
  const sign = rounded < 0 ? "Minus " : "";
  const chhertumWords = chhertum > 0 ? numberToWords(chhertum) : "Zero";
  return `${sign}Ngultrum ${numberToWords(whole)} and ${chhertumWords} Chhertum Only`;
};

export const fiscalYearLabel = (fiscalYear: string) => `FY ${fiscalYear.replace("-", "–")}`;

/** Today in Bhutan (UTC+6), independent of the browser's own time zone. */
export const currentBhutanDate = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Thimphu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export const currentBhutanMonth = () => currentBhutanDate().slice(0, 7);

export const payMonthLabel = (payMonth: string) => {
  const [year, month] = payMonth.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-BT", { month: "long", year: "numeric" });
};

/** Month options for a fiscal year, July first. */
export const fiscalYearMonthOptions = (fiscalYear: string) => {
  const startYear = Number(fiscalYear.slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => {
    const monthIndex = index + 6;
    const year = startYear + Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    return {
      value: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: new Date(year, month, 1).toLocaleDateString("en-BT", { month: "long", year: "numeric" }),
    };
  });
};

/** dd/mm/yyyy for printed vouchers; blanks print as a signature rule. */
export const voucherDate = (value?: string | null) => {
  if (!value) return "________________";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return "________________";
  return parsed.toLocaleDateString("en-GB");
};

export const tableDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-BT", { day: "2-digit", month: "short", year: "numeric" });

export const timestamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("en-BT", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
