"use client";

import { useMemo, useState } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { VoucherModal } from "@/components/vouchers/voucher-modal";
import { VoucherPrintModal } from "@/components/vouchers/voucher-print-modal";
import { VoucherTable, voucherDisplayType } from "@/components/vouchers/voucher-parts";
import { api } from "@/lib/api";
import { fiscalYearLabel, fiscalYearMonthOptions, money, payMonthLabel } from "@/lib/format";
import { activeAccountingMonth } from "@/lib/reconciliation";
import { workspaceTotals } from "@/lib/totals";
import { voucherBankEffectNu } from "@/lib/vouchers";
import { useApp } from "@/providers/app-provider";
import type { AccountingData, Voucher } from "@/types";

export default function VouchersPage() {
  return <RouteGuard>{(data) => <VoucherRegister data={data} />}</RouteGuard>;
}

function VoucherRegister({ data }: { data: AccountingData }) {
  const { can, fiscalYear, run } = useApp();
  const { vouchers, activities, currentUser } = data;

  const voucherPeriods = useMemo(() => fiscalYearMonthOptions(fiscalYear), [fiscalYear]);
  // The active accounting month rolls forward past any closed months, so once
  // September is closed the register opens (and allows creating) in October.
  const activeMonth = useMemo(
    () => activeAccountingMonth(fiscalYear, data.monthClosures),
    [fiscalYear, data.monthClosures],
  );
  const [selectedVoucherMonth, setSelectedVoucherMonth] = useState(() => activeMonth);
  const [entryOpen, setEntryOpen] = useState(false);
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);

  const totals = useMemo(() => workspaceTotals(data), [data]);
  const visibleVouchers = vouchers.filter((voucher) => voucher.transactionDate.startsWith(selectedVoucherMonth));
  const pendingBankEffectNu = vouchers
    .filter((voucher) => voucher.status === "Pending")
    .reduce((sum, voucher) => sum + voucherBankEffectNu(voucher), 0);

  const canCreate = can("create_voucher") || can("record_fund_receipt");

  const submitVoucher = async (voucher: Voucher) => {
    const confirmed = window.confirm(
      `Submit ${voucherDisplayType(voucher)} ${voucher.voucherNumber} for approval?\n\nAfter submission, an Admin or Approving Authority can approve or return it.`,
    );
    if (!confirmed) return;
    await run(
      () => api.submitVoucher(voucher.id, fiscalYear),
      `${voucherDisplayType(voucher)} ${voucher.voucherNumber} was submitted for approval.`,
    );
  };

  return (
    <>
      <section className="bank-balance-overview" aria-label="Bank balance provision">
        <div className="bank-balance-account">
          <span className="bank-balance-icon">Nu</span>
          <div>
            <small>Operating bank account</small>
            <strong>110116024748</strong>
            <p>Balance calculated from approved and paid vouchers in {fiscalYearLabel(fiscalYear)}.</p>
            <p>Cash in hand: {money.format(totals.cashInHand)}</p>
          </div>
        </div>
        <div>
          <small>Current bank balance</small>
          <strong>{money.format(totals.bankMovement)}</strong>
          <p>Posted bank receipts less net payments and advances</p>
        </div>
        <div>
          <small>Pending voucher effect</small>
          <strong>{money.format(pendingBankEffectNu)}</strong>
          <p>Applied only after approval</p>
        </div>
        <div>
          <small>Balance after pending approvals</small>
          <strong>{money.format(totals.bankMovement + pendingBankEffectNu)}</strong>
          <p>Projected system balance</p>
        </div>
      </section>

      <section className="panel voucher-register-selection" aria-label="Voucher register month selection">
        <div>
          <span className="eyebrow dark">Voucher period</span>
          <h3>Select voucher month</h3>
          <p>The register opens on the current open accounting month. Closed months remain available for review.</p>
        </div>
        <label>
          Month
          <select value={selectedVoucherMonth} onChange={(event) => setSelectedVoucherMonth(event.target.value)}>
            {voucherPeriods.map((period) => (
              <option key={period.value} value={period.value} disabled={period.value > activeMonth}>
                {period.label}
                {period.value === activeMonth ? " · Current period" : ""}
              </option>
            ))}
          </select>
          <small>
            Bank reconciliation and month closing are required before voucher processing can move beyond the current open
            month.
          </small>
        </label>
      </section>

      <section className="panel register-panel">
        <div className="register-toolbar">
          <div>
            <h3>Voucher register</h3>
            <p>{payMonthLabel(selectedVoucherMonth)} · Payment, journal, receipt, direct transaction and advance vouchers</p>
          </div>
          <div className="voucher-register-actions">
            <span className="fy-chip">
              {visibleVouchers.length} VOUCHER{visibleVouchers.length === 1 ? "" : "S"}
            </span>
            {canCreate && selectedVoucherMonth === activeMonth && (
              <button className="primary-button" onClick={() => setEntryOpen(true)}>
                ＋ Create voucher
              </button>
            )}
          </div>
        </div>
        <VoucherTable
          vouchers={visibleVouchers}
          onPrint={setPrintVoucher}
          onSubmit={submitVoucher}
          currentUserId={currentUser.id}
          emptyMessage={`No vouchers were recorded in ${payMonthLabel(selectedVoucherMonth)}.`}
        />
      </section>

      {entryOpen && (
        <VoucherModal
          activities={activities}
          vouchers={vouchers}
          tpnRegistrations={data.tpnRegistrations}
          monthClosures={data.monthClosures}
          bankBalanceNu={totals.bankMovement}
          cashInHandNu={totals.cashInHand}
          onClose={() => setEntryOpen(false)}
        />
      )}

      {printVoucher && (
        <VoucherPrintModal
          voucher={printVoucher}
          activity={activities.find((activity) => activity.id === printVoucher.activityId)}
          onClose={() => setPrintVoucher(null)}
        />
      )}
    </>
  );
}
