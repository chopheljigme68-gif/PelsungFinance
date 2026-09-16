/**
 * Cash-book position for the monthly bank reconciliation.
 *
 * Mirrors `backend/src/modules/reconciliation/reconciliation.service.ts`
 * (`loadCashBookPosition`). The cash book is built from posted vouchers dated
 * on or before the end of the statement month:
 *   • total funds received  — sum of posted Receipt vouchers
 *   • closing cash-book bal. — signed bank effect of every posted voucher
 *   • fund withdrawn         — funds received less the closing balance
 */

import { isPostedStatus, voucherBankEffectNu } from "@/lib/vouchers";
import { currentBhutanMonth, fiscalYearMonthOptions, roundNu } from "@/lib/format";
import { OPERATING_BANK_ACCOUNT } from "@/lib/reference";
import type { MonthClosure, Voucher } from "@/types";

/**
 * The active accounting month for an account. It starts at the current calendar
 * month and rolls forward past any months already closed — so closing September
 * automatically makes October the active month. It never runs past the fiscal
 * year's own last month.
 */
export function activeAccountingMonth(
  fiscalYear: string,
  monthClosures: MonthClosure[],
  accountNumber: string = OPERATING_BANK_ACCOUNT,
): string {
  const fyMonths = fiscalYearMonthOptions(fiscalYear).map((month) => month.value); // Jul → Jun, ascending
  if (!fyMonths.length) return currentBhutanMonth();
  const closed = new Set(
    monthClosures.filter((closure) => closure.accountNumber === accountNumber).map((closure) => closure.closeMonth),
  );
  const current = currentBhutanMonth();

  // Anchor to the current month within the fiscal year (clamp if the calendar
  // month falls outside it), then step forward over consecutive closed months.
  let index = fyMonths.indexOf(current);
  if (index === -1) index = current < fyMonths[0] ? 0 : fyMonths.length - 1;
  while (index < fyMonths.length - 1 && closed.has(fyMonths[index])) index += 1;
  return fyMonths[index];
}

export type CashBookPosition = {
  totalFundsReceivedNu: number;
  closingCashBookBalanceNu: number;
  cashBookWithdrawalsNu: number;
};

export function cashBookPositionForMonth(vouchers: Voucher[], statementMonth: string): CashBookPosition {
  const posted = vouchers.filter(
    (voucher) => isPostedStatus(voucher.status) && voucher.transactionDate <= `${statementMonth}-31`,
  );
  const totalFundsReceivedNu = roundNu(
    posted
      .filter((voucher) => voucher.voucherType === "Receipt")
      .reduce((sum, voucher) => sum + Number(voucher.amountNu), 0),
  );
  const closingCashBookBalanceNu = roundNu(
    posted.reduce((sum, voucher) => sum + voucherBankEffectNu(voucher), 0),
  );
  return {
    totalFundsReceivedNu,
    closingCashBookBalanceNu,
    cashBookWithdrawalsNu: roundNu(totalFundsReceivedNu - closingCashBookBalanceNu),
  };
}

export type EditableBankReconciliationItem = {
  key: string;
  itemType: "add" | "less";
  transactionDate: string;
  reference: string;
  particulars: string;
  amountNu: string;
};
