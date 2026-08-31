"use client";

import { useMemo, useState } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { Empty } from "@/components/ui/primitives";
import { fiscalYearMonthOptions, money, payMonthLabel } from "@/lib/format";
import { ledgerRowsForVoucher } from "@/lib/ledger";
import { useApp } from "@/providers/app-provider";
import type { AccountingData } from "@/types";

export default function LedgerPage() {
  return <RouteGuard>{(data) => <Ledger data={data} />}</RouteGuard>;
}

function Ledger({ data }: { data: AccountingData }) {
  const { fiscalYear } = useApp();
  const ledgerPeriods = useMemo(() => fiscalYearMonthOptions(fiscalYear), [fiscalYear]);
  const [selectedLedgerMonth, setSelectedLedgerMonth] = useState("");

  const rows = useMemo(
    () =>
      data.vouchers
        .filter((voucher) => ["Approved", "Paid", "Reversed"].includes(voucher.status))
        .flatMap(ledgerRowsForVoucher)
        .filter((row) => selectedLedgerMonth && row.date.startsWith(selectedLedgerMonth)),
    [data.vouchers, selectedLedgerMonth],
  );

  return (
    <>
      <section className="panel ledger-month-selection" aria-label="General Ledger month selection">
        <div>
          <span className="eyebrow dark">Ledger period</span>
          <h3>Select month</h3>
          <p>General Ledger details will display only after a month is selected.</p>
        </div>
        <label>
          Month
          <select value={selectedLedgerMonth} onChange={(event) => setSelectedLedgerMonth(event.target.value)}>
            <option value="">Select month</option>
            {ledgerPeriods.map((period) => (
              <option key={period.value} value={period.value}>
                {period.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {selectedLedgerMonth && (
        <section className="panel register-panel">
          <div className="register-toolbar">
            <div>
              <h3>General ledger preview</h3>
              <p>
                {payMonthLabel(selectedLedgerMonth)} · Posted expenditure, TDS payable, advance recovery, bank movements
                and authorised reversals.
              </p>
            </div>
            <button className="secondary-button" onClick={() => window.print()}>
              Print ledger
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Account</th>
                  <th>Particulars</th>
                  <th className="amount-cell">Debit</th>
                  <th className="amount-cell">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className={row.reversal ? "ledger-reversal" : row.creditNu ? "ledger-credit" : ""} key={row.key}>
                    <td>{row.date}</td>
                    <td>{row.reference}</td>
                    <td>{row.account}</td>
                    <td>{row.particulars}</td>
                    <td className="amount-cell">{row.debitNu === null ? "—" : money.format(row.debitNu)}</td>
                    <td className="amount-cell">{row.creditNu === null ? "—" : money.format(row.creditNu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <Empty message={`No posted ledger entries exist for ${payMonthLabel(selectedLedgerMonth)}.`} />
            )}
          </div>
        </section>
      )}
    </>
  );
}
