"use client";

import { useMemo, useState } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { VoucherModal } from "@/components/vouchers/voucher-modal";
import { VoucherPrintModal } from "@/components/vouchers/voucher-print-modal";
import { VoucherTable, voucherDisplayType } from "@/components/vouchers/voucher-parts";
import { api } from "@/lib/api";
import { fiscalYearLabel, fiscalYearMonthOptions, money, payMonthLabel } from "@/lib/format";
import { activeAccountingMonth, closedAccountingMonths } from "@/lib/reconciliation";
import { workspaceTotals } from "@/lib/totals";
import { isVoucherEditableBy, voucherBankEffectNu } from "@/lib/vouchers";
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
  // Vouchers can be entered in any month of the fiscal year that has not been
  // closed; a closed month stays open for review only.
  const closedMonths = useMemo(() => closedAccountingMonths(data.monthClosures), [data.monthClosures]);
  const selectedMonthClosed = closedMonths.has(selectedVoucherMonth);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);

  const totals = useMemo(() => workspaceTotals(data), [data]);
  const visibleVouchers = vouchers.filter((voucher) => voucher.transactionDate.startsWith(selectedVoucherMonth));
  const pendingBankEffectNu = vouchers
    .filter((voucher) => voucher.status === "Pending")
    .reduce((sum, voucher) => sum + voucherBankEffectNu(voucher), 0);

  const canCreate = can("create_voucher") || can("record_fund_receipt");
  // The server enforces the same rule; this only decides where the Edit button shows.
  const canEditVoucher = (voucher: Voucher) =>
    isVoucherEditableBy(voucher, currentUser.id) &&
    !closedMonths.has(voucher.transactionDate.slice(0, 7)) &&
    (voucher.voucherType === "Receipt" ? can("record_fund_receipt") : can("create_voucher"));

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
          <p>
            The register opens on the current accounting month. Vouchers can be added in any month that has not been
            closed; closed months are available for review only.
          </p>
        </div>
        <label>
          Month
          <select value={selectedVoucherMonth} onChange={(event) => setSelectedVoucherMonth(event.target.value)}>
            {voucherPeriods.map((period) => (
              <option key={period.value} value={period.value}>
                {period.label}
                {period.value === activeMonth ? " · Current period" : ""}
                {closedMonths.has(period.value) ? " · Closed" : ""}
              </option>
            ))}
          </select>
          <small>
            {selectedMonthClosed
              ? `${payMonthLabel(selectedVoucherMonth)} is closed. New vouchers can't be added to a closed month.`
              : "Pick any open month to view its vouchers or add new ones."}
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
            {canCreate && !selectedMonthClosed && (
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
          onEdit={setEditingVoucher}
          isEditable={canEditVoucher}
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
          entryMonth={selectedVoucherMonth}
          bankBalanceNu={totals.bankMovement}
          cashInHandNu={totals.cashInHand}
          onClose={() => setEntryOpen(false)}
        />
      )}

      {editingVoucher && (
        <VoucherModal
          key={editingVoucher.id}
          editVoucher={editingVoucher}
          activities={activities}
          vouchers={vouchers}
          tpnRegistrations={data.tpnRegistrations}
          monthClosures={data.monthClosures}
          bankBalanceNu={totals.bankMovement}
          cashInHandNu={totals.cashInHand}
          onClose={() => setEditingVoucher(null)}
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
