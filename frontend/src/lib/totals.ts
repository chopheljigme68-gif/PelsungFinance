import { isPostedStatus, voucherBankEffectNu, voucherCashEffectNu } from "@/lib/vouchers";
import type { AccountingData, Voucher } from "@/types";

/** Advance still outstanding after approved or paid recoveries. */
export function outstandingAdvanceBalance(advance: Voucher, vouchers: Voucher[]): number {
  const recovered = vouchers
    .filter((voucher) => voucher.advanceRecoveryVoucherId === advance.id && isPostedStatus(voucher.status))
    .reduce((sum, voucher) => sum + voucher.advanceRecoveryNu, 0);
  return Math.max(0, advance.amountNu - recovered);
}

export type WorkspaceTotals = {
  approved: number;
  utilized: number;
  committed: number;
  available: number;
  current: number;
  capital: number;
  pending: number;
  bankMovement: number;
  cashInHand: number;
  outstandingAdvances: number;
};

/**
 * The figures every screen shares.
 *
 * `utilized` counts paid expenditure, `committed` counts approved *and* paid —
 * available budget is approved less committed, so an approved voucher reserves
 * its allocation immediately.
 */
export function workspaceTotals(data: Pick<AccountingData, "activities" | "vouchers">): WorkspaceTotals {
  const { activities, vouchers } = data;
  const approved = activities.reduce((sum, item) => sum + Number(item.approvedNu), 0);
  const utilized = activities.reduce((sum, item) => sum + Number(item.utilizedNu), 0);
  const committed = activities.reduce((sum, item) => sum + Number(item.committedNu), 0);
  const current = activities
    .filter((item) => item.budgetType === "Current")
    .reduce((sum, item) => sum + Number(item.approvedNu), 0);
  const posted = vouchers.filter((voucher) => isPostedStatus(voucher.status));

  return {
    approved,
    utilized,
    committed,
    available: approved - committed,
    current,
    capital: approved - current,
    pending: vouchers.filter((voucher) => voucher.status === "Pending").length,
    bankMovement: posted.reduce((sum, voucher) => sum + voucherBankEffectNu(voucher), 0),
    cashInHand: posted.reduce((sum, voucher) => sum + voucherCashEffectNu(voucher), 0),
    outstandingAdvances: posted
      .filter((voucher) => voucher.voucherType === "Advance")
      .reduce((sum, voucher) => sum + outstandingAdvanceBalance(voucher, vouchers), 0),
  };
}

/** Approved allocation per programme, largest first. */
export function programmeTotals(activities: AccountingData["activities"]) {
  const grouped = new Map<string, number>();
  for (const item of activities) {
    grouped.set(item.category, (grouped.get(item.category) ?? 0) + Number(item.approvedNu));
  }
  return [...grouped.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}
