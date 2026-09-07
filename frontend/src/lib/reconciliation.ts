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
import { roundNu } from "@/lib/format";
import type { Voucher } from "@/types";

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
