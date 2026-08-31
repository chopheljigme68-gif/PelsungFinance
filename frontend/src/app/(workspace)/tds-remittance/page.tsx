"use client";

import { useMemo, useState } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { Empty, ModuleHero } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { currentBhutanMonth, fiscalYearLabel, fiscalYearMonthOptions, money, payMonthLabel, voucherDate } from "@/lib/format";
import { isPostedStatus } from "@/lib/vouchers";
import { useApp } from "@/providers/app-provider";
import type { AccountingData } from "@/types";

export default function TdsRemittancePage() {
  return <RouteGuard permission="create_voucher">{(data) => <TdsRemittanceModule data={data} />}</RouteGuard>;
}

/**
 * Supplier TDS remittance.
 *
 * Collects every approved supplier payment of a month at one rate whose TDS has
 * not been remitted, and generates a single Draft Payment Voucher for the
 * Department of Revenue and Customs.
 */
function TdsRemittanceModule({ data }: { data: AccountingData }) {
  const { fiscalYear, run } = useApp();
  const remittancePeriods = useMemo(() => fiscalYearMonthOptions(fiscalYear), [fiscalYear]);
  const currentMonth = currentBhutanMonth();
  const defaultRemittanceMonth = remittancePeriods.some((period) => period.value === currentMonth)
    ? currentMonth
    : remittancePeriods[0].value;

  const [remittanceMonth, setRemittanceMonth] = useState(defaultRemittanceMonth);
  const [remittanceRate, setRemittanceRate] = useState<2 | 5>(2);
  const [generating, setGenerating] = useState(false);

  const approvedSupplierTdsVouchers = data.vouchers
    .filter(
      (voucher) =>
        isPostedStatus(voucher.status) &&
        voucher.voucherType === "Payment" &&
        !voucher.payrollEntryType &&
        voucher.tdsRate === remittanceRate &&
        voucher.tdsNu > 0,
    )
    .filter((voucher) => voucher.transactionDate.startsWith(remittanceMonth))
    .sort(
      (a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.voucherNumber.localeCompare(b.voucherNumber),
    );

  const unremitted = approvedSupplierTdsVouchers.filter((voucher) => !voucher.supplierTdsRemitted);
  const unremittedNu = unremitted.reduce((sum, voucher) => sum + voucher.tdsNu, 0);
  const activeRun = data.supplierTdsRemittanceRuns.find(
    (run_) => run_.payMonth === remittanceMonth && run_.tdsRate === remittanceRate && run_.status !== "Reversed",
  );

  const generate = async () => {
    if (!unremitted.length || activeRun) return;
    const confirmed = window.confirm(
      `Generate one Draft Payment Voucher to remit ${money.format(unremittedNu)} of ${remittanceRate}% supplier TDS from ${unremitted.length} approved voucher${unremitted.length === 1 ? "" : "s"}?\n\nThe remittance affects the bank only after approval and has no budget impact.`,
    );
    if (!confirmed) return;

    setGenerating(true);
    await run(
      () => api.finalizeSupplierTdsRemittance({ fiscalYear, payMonth: remittanceMonth, tdsRate: remittanceRate }),
      `${remittanceRate}% TDS Remittance was prepared. One Draft Payment Voucher was generated under Vouchers; submit it for approval.`,
    );
    setGenerating(false);
  };

  return (
    <>
      <ModuleHero
        eyebrow="Voucher deductions"
        title="TDS Remittance"
        description="Prepare monthly remittance from approved supplier vouchers containing 2% or 5% TDS."
        actions={<span className="fy-chip">{fiscalYearLabel(fiscalYear)}</span>}
      />

      <section className="panel supplier-tds-workbench">
        <div className="register-toolbar">
          <div>
            <h3>TDS Remittance Workbench</h3>
            <p>
              Select a month and TDS rate. The generated Draft Payment Voucher will appear under Vouchers for submission
              and approval.
            </p>
          </div>
          <span className="fy-chip">VOUCHER WORKFLOW</span>
        </div>

        <div className="supplier-tds-controls">
          <label>
            Month
            <select value={remittanceMonth} onChange={(event) => setRemittanceMonth(event.target.value)}>
              {remittancePeriods.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            TDS rate
            <select value={remittanceRate} onChange={(event) => setRemittanceRate(Number(event.target.value) as 2 | 5)}>
              <option value={2}>2% TDS</option>
              <option value={5}>5% TDS</option>
            </select>
          </label>
          <div>
            <span>Approved vouchers</span>
            <strong>{approvedSupplierTdsVouchers.length}</strong>
            <small>Only approved supplier vouchers are eligible</small>
          </div>
          <div>
            <span>TDS awaiting remittance</span>
            <strong>{money.format(unremittedNu)}</strong>
            <small>
              {activeRun?.voucherNumber
                ? `Generated as ${activeRun.voucherNumber}`
                : `${unremitted.length} voucher${unremitted.length === 1 ? "" : "s"} ready`}
            </small>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={generating || !unremitted.length || Boolean(activeRun)}
            onClick={() => void generate()}
          >
            {generating
              ? "Generating…"
              : activeRun
                ? `Remittance ${activeRun.voucherNumber ?? "generated"}`
                : `Generate ${remittanceRate}% TDS Remittance Voucher`}
          </button>
        </div>

        <div className="table-scroll supplier-tds-source-table">
          <table>
            <thead>
              <tr>
                <th>Supplier voucher</th>
                <th>Date</th>
                <th>Supplier / particulars</th>
                <th className="amount-cell">Gross</th>
                <th className="amount-cell">GST</th>
                <th className="amount-cell">TDS basis</th>
                <th className="amount-cell">TDS</th>
                <th>Remittance</th>
              </tr>
            </thead>
            <tbody>
              {approvedSupplierTdsVouchers.map((voucher) => (
                <tr key={voucher.id}>
                  <td>
                    <strong className="voucher-number">{voucher.voucherNumber}</strong>
                    <small>{voucher.tdsRate}% TDS</small>
                  </td>
                  <td>{voucherDate(voucher.transactionDate)}</td>
                  <td>
                    <strong>{voucher.payee}</strong>
                    <small>TPN: {voucher.tpn || "Not recorded"}</small>
                    <small>{voucher.description}</small>
                    {voucher.billReference && <small>Reference: {voucher.billReference}</small>}
                  </td>
                  <td className="amount-cell">{money.format(voucher.amountNu)}</td>
                  <td className="amount-cell">{money.format(voucher.gstNu)}</td>
                  <td className="amount-cell">{money.format(voucher.amountNu - voucher.gstNu)}</td>
                  <td className="amount-cell">
                    <strong>{money.format(voucher.tdsNu)}</strong>
                  </td>
                  <td>
                    <span className={`status ${voucher.supplierTdsRemitted ? "status-approved" : "status-pending"}`}>
                      <i />
                      {voucher.supplierTdsRemitted ? "Assigned" : "Awaiting"}
                    </span>
                    {voucher.supplierTdsRemittanceVoucherNumber && (
                      <small>{voucher.supplierTdsRemittanceVoucherNumber}</small>
                    )}
                  </td>
                </tr>
              ))}
              {!approvedSupplierTdsVouchers.length && (
                <tr>
                  <td colSpan={8}>
                    <Empty
                      message={`No approved ${remittanceRate}% supplier TDS vouchers exist for ${payMonthLabel(remittanceMonth)}.`}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
