import { isPostedStatus } from "@/lib/vouchers";
import type { Activity, PayrollEntryType, Voucher, VoucherStatus } from "@/types";

export type ReportGroup = "Monthly" | "Administrative";
export type ReportType =
  | "expenditure"
  | "receipts-payments"
  | "outstanding-advances"
  | "tds-2"
  | "tds-5"
  | "budget-balance";

export type ReportRequest = {
  group: ReportGroup;
  reportType: ReportType;
  month: string;
  activityId: string;
  programme: string;
};

export type ReportEntry = {
  key: string;
  date: string;
  reference: string;
  voucherType: string;
  payrollEntryType: PayrollEntryType | null;
  billReference: string | null;
  payee: string;
  particulars: string;
  activityId: number | null;
  activityIds: number[];
  obc: string;
  activity: string;
  entry: string;
  status: VoucherStatus;
  direction: "receipt" | "payment";
  amountNu: number;
  cashAmountNu: number;
};

const POSTED_OR_REVERSED: VoucherStatus[] = ["Approved", "Paid", "Reversed"];

function entryLabel(status: VoucherStatus): string {
  if (status === "Reversed") return "Original entry - subsequently reversed";
  if (status === "Paid") return "Paid transaction";
  return "Approved transaction";
}

/**
 * Expenditure is reported per budget allocation, so a voucher split across
 * three activities appears as three lines. A reversal adds a negative mirror
 * line dated at the reversal, keeping both sides visible in the statement.
 */
export function expenditureEntries(vouchers: Voucher[]): ReportEntry[] {
  return vouchers
    .filter((voucher) => POSTED_OR_REVERSED.includes(voucher.status))
    .flatMap((voucher) => {
      const allocations = voucher.budgetLines.length
        ? voucher.budgetLines
        : voucher.activityId
          ? [{ id: 0, activityId: voucher.activityId, obc: voucher.obc, activity: voucher.activity, amountNu: voucher.amountNu }]
          : [];

      return allocations.flatMap((allocation) => {
        const original: ReportEntry = {
          key: `${voucher.id}-${allocation.id}-original`,
          date: voucher.transactionDate,
          reference: voucher.voucherNumber,
          voucherType: voucher.voucherType,
          payrollEntryType: voucher.payrollEntryType,
          billReference: voucher.billReference ?? null,
          payee: voucher.payee,
          particulars: voucher.description,
          activityId: allocation.activityId,
          activityIds: [allocation.activityId],
          obc: allocation.obc,
          activity: allocation.activity,
          entry: entryLabel(voucher.status),
          status: voucher.status,
          direction: "payment",
          amountNu: allocation.amountNu,
          cashAmountNu: allocation.amountNu,
        };
        if (voucher.status !== "Reversed") return [original];
        return [
          original,
          {
            ...original,
            key: `${voucher.id}-${allocation.id}-reversal`,
            date: voucher.reversedAt?.slice(0, 10) ?? voucher.transactionDate,
            reference: `${voucher.voucherNumber} · REV`,
            payee: voucher.reversedByName ?? voucher.payee,
            particulars: `Reversal: ${voucher.reversalReason}`,
            entry: "Authorised reversal",
            status: "Reversed" as const,
            amountNu: -allocation.amountNu,
            cashAmountNu: -allocation.amountNu,
          },
        ];
      });
    });
}

/** Receipts and payments follow the cash actually moved, not the gross bill. */
export function cashEntries(vouchers: Voucher[]): ReportEntry[] {
  return vouchers
    .filter((voucher) => POSTED_OR_REVERSED.includes(voucher.status))
    .flatMap((voucher) => {
      const activityIds = voucher.budgetLines.map((line) => line.activityId);
      const obc = voucher.budgetLines.length > 1 ? voucher.budgetLines.map((line) => line.obc).join(", ") : voucher.obc;
      const activity =
        voucher.budgetLines.length > 1 ? `${voucher.budgetLines.length} budget activities` : voucher.activity;
      const direction = voucher.voucherType === "Receipt" ? ("receipt" as const) : ("payment" as const);
      const cashAmountNu = voucher.voucherType === "Payment" ? voucher.netPaymentNu : voucher.amountNu;

      const original: ReportEntry = {
        key: `${voucher.id}-cash-original`,
        date: voucher.transactionDate,
        reference: voucher.voucherNumber,
        voucherType: voucher.voucherType,
        payrollEntryType: voucher.payrollEntryType,
        billReference: voucher.billReference ?? null,
        payee: voucher.payee,
        particulars: voucher.description,
        activityId: voucher.activityId,
        activityIds: activityIds.length ? activityIds : voucher.activityId ? [voucher.activityId] : [],
        obc,
        activity,
        entry: entryLabel(voucher.status),
        status: voucher.status,
        direction,
        amountNu: voucher.amountNu,
        cashAmountNu,
      };
      if (voucher.status !== "Reversed") return [original];
      return [
        original,
        {
          ...original,
          key: `${voucher.id}-cash-reversal`,
          date: voucher.reversedAt?.slice(0, 10) ?? voucher.transactionDate,
          reference: `${voucher.voucherNumber} · REV`,
          payee: voucher.reversedByName ?? voucher.payee,
          particulars: `Reversal: ${voucher.reversalReason}`,
          entry: "Authorised reversal",
          status: "Reversed" as const,
          amountNu: -voucher.amountNu,
          cashAmountNu: -cashAmountNu,
        },
      ];
    });
}

/** The last calendar date of the report month. */
export function reportEndDate(month: string): string {
  const [year, selectedMonth] = month.split("-").map(Number);
  const lastDay = new Date(year, selectedMonth, 0).getDate();
  return `${year}-${String(selectedMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export type OutstandingAdvanceLine = { voucher: Voucher; recoveredNu: number; outstandingNu: number };

/**
 * Advances still outstanding at a month end, as at that date: a voucher
 * reversed *after* the cut-off was still outstanding on it.
 */
export function outstandingAdvancesAsAt(vouchers: Voucher[], endDate: string): OutstandingAdvanceLine[] {
  const liveAt = (voucher: Voucher) =>
    isPostedStatus(voucher.status) ||
    (voucher.status === "Reversed" && (voucher.reversedAt?.slice(0, 10) ?? voucher.transactionDate) > endDate);

  return vouchers
    .filter((voucher) => voucher.voucherType === "Advance" && voucher.transactionDate <= endDate)
    .filter(liveAt)
    .map((voucher) => {
      const recoveredNu = vouchers
        .filter((recovery) => recovery.advanceRecoveryVoucherId === voucher.id && recovery.transactionDate <= endDate)
        .filter(liveAt)
        .reduce((sum, recovery) => sum + recovery.advanceRecoveryNu, 0);
      return { voucher, recoveredNu, outstandingNu: Math.max(0, voucher.amountNu - recoveredNu) };
    })
    .filter((item) => item.outstandingNu > 0)
    .sort(
      (a, b) =>
        a.voucher.transactionDate.localeCompare(b.voucher.transactionDate) ||
        a.voucher.voucherNumber.localeCompare(b.voucher.voucherNumber),
    );
}

/** Approved supplier vouchers carrying TDS at one rate in one month. */
export function tdsScheduleEntries(vouchers: Voucher[], month: string, rate: 2 | 5): Voucher[] {
  return vouchers
    .filter(
      (voucher) =>
        isPostedStatus(voucher.status) &&
        voucher.voucherType === "Payment" &&
        !voucher.payrollEntryType &&
        voucher.tdsRate === rate &&
        voucher.tdsNu > 0,
    )
    .filter((voucher) => voucher.transactionDate.startsWith(month))
    .sort(
      (a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.voucherNumber.localeCompare(b.voucherNumber),
    );
}

export function budgetBalanceActivities(activities: Activity[], programme: string): Activity[] {
  return activities
    .filter((activity) => programme === "all" || activity.category === programme)
    .sort((a, b) => a.obc.localeCompare(b.obc) || a.activity.localeCompare(b.activity));
}

/** Applies the month, activity and report-kind filters to prepared entries. */
export function filterReportEntries(entries: ReportEntry[], request: ReportRequest): ReportEntry[] {
  return entries
    .filter((entry) => entry.date.startsWith(request.month))
    .filter((entry) => request.activityId === "all" || entry.activityIds.includes(Number(request.activityId)))
    .filter((entry) =>
      request.reportType === "receipts-payments"
        ? !entry.payrollEntryType ||
          ["net", "combined", "tds_hc_remittance", "supplier_tds_remittance"].includes(entry.payrollEntryType)
        : entry.direction === "payment" &&
          entry.voucherType !== "Advance" &&
          (!entry.payrollEntryType || ["gross", "combined"].includes(entry.payrollEntryType)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
}

export const reportTitles: Record<ReportType, string> = {
  "budget-balance": "Budget Balance Report",
  "receipts-payments": "Receipts and Payments",
  "outstanding-advances": "Outstanding Advances Report",
  "tds-2": "2% TDS Schedule",
  "tds-5": "5% TDS Schedule",
  expenditure: "Detailed Expenditure Statement",
};
