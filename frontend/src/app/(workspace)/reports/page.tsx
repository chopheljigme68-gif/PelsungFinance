"use client";

import { useMemo, useState, type FormEvent } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { PelsungLogo } from "@/components/ui/primitives";
import { fiscalYearLabel, fiscalYearMonthOptions, money, voucherDate } from "@/lib/format";
import {
  budgetBalanceActivities,
  cashEntries,
  expenditureEntries,
  filterReportEntries,
  outstandingAdvancesAsAt,
  reportEndDate,
  reportTitles,
  tdsScheduleEntries,
  type ReportGroup,
  type ReportRequest,
  type ReportType,
} from "@/lib/reports";
import { useApp } from "@/providers/app-provider";
import type { AccountingData } from "@/types";

export default function ReportsPage() {
  return <RouteGuard permission="view_reports">{(data) => <Reports data={data} />}</RouteGuard>;
}

function Reports({ data }: { data: AccountingData }) {
  const { fiscalYear, changeFiscalYear } = useApp();
  const { activities, vouchers, fiscalYears } = data;
  const periods = useMemo(() => fiscalYearMonthOptions(fiscalYear), [fiscalYear]);

  const [reportGroup, setReportGroup] = useState<ReportGroup>("Monthly");
  const [reportType, setReportType] = useState<ReportType>("expenditure");
  const [month, setMonth] = useState(() => periods[0].value);
  const [activityId, setActivityId] = useState("all");
  const [programme, setProgramme] = useState("all");
  const [generated, setGenerated] = useState<ReportRequest | null>(null);

  const programmes = useMemo(
    () => Array.from(new Set(activities.map((activity) => activity.category))).sort((a, b) => a.localeCompare(b)),
    [activities],
  );

  const preparedExpenditure = useMemo(() => expenditureEntries(vouchers), [vouchers]);
  const preparedCash = useMemo(() => cashEntries(vouchers), [vouchers]);

  const previewEntries = useMemo(() => {
    if (!generated || ["outstanding-advances", "tds-2", "tds-5", "budget-balance"].includes(generated.reportType)) {
      return [];
    }
    return filterReportEntries(
      generated.reportType === "receipts-payments" ? preparedCash : preparedExpenditure,
      generated,
    );
  }, [generated, preparedCash, preparedExpenditure]);

  const endDate = generated ? reportEndDate(generated.month) : "";
  const outstandingAdvances = useMemo(
    () => (generated?.reportType === "outstanding-advances" ? outstandingAdvancesAsAt(vouchers, endDate) : []),
    [endDate, generated?.reportType, vouchers],
  );
  const tdsEntries = useMemo(
    () =>
      generated && ["tds-2", "tds-5"].includes(generated.reportType)
        ? tdsScheduleEntries(vouchers, generated.month, generated.reportType === "tds-2" ? 2 : 5)
        : [],
    [generated, vouchers],
  );
  const balanceActivities = useMemo(
    () => (generated?.reportType === "budget-balance" ? budgetBalanceActivities(activities, generated.programme) : []),
    [activities, generated],
  );

  const grossExpenditure = previewEntries
    .filter((entry) => entry.direction === "payment" && entry.amountNu > 0)
    .reduce((sum, entry) => sum + entry.amountNu, 0);
  const expenditureReversals = previewEntries
    .filter((entry) => entry.direction === "payment" && entry.amountNu < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.amountNu), 0);
  const netExpenditure = previewEntries
    .filter((entry) => entry.direction === "payment")
    .reduce((sum, entry) => sum + entry.amountNu, 0);
  const totalReceipts = previewEntries
    .filter((entry) => entry.direction === "receipt")
    .reduce((sum, entry) => sum + entry.amountNu, 0);
  const totalPayments = previewEntries
    .filter((entry) => entry.direction === "payment")
    .reduce((sum, entry) => sum + entry.cashAmountNu, 0);
  const totalOutstandingAdvances = outstandingAdvances.reduce((sum, item) => sum + item.outstandingNu, 0);
  const tdsTotals = tdsEntries.reduce(
    (total, voucher) => ({
      grossNu: total.grossNu + voucher.amountNu,
      gstNu: total.gstNu + voucher.gstNu,
      taxableNu: total.taxableNu + (voucher.amountNu - voucher.gstNu),
      tdsNu: total.tdsNu + voucher.tdsNu,
      netNu: total.netNu + voucher.netPaymentNu,
    }),
    { grossNu: 0, gstNu: 0, taxableNu: 0, tdsNu: 0, netNu: 0 },
  );
  const unremittedTdsEntries = tdsEntries.filter((voucher) => !voucher.supplierTdsRemitted);
  const balanceTotals = balanceActivities.reduce(
    (total, activity) => ({
      approvedNu: total.approvedNu + activity.approvedNu,
      utilizedNu: total.utilizedNu + activity.utilizedNu,
      commitmentsNu: total.commitmentsNu + Math.max(activity.committedNu - activity.utilizedNu, 0),
      committedNu: total.committedNu + activity.committedNu,
      availableNu: total.availableNu + (activity.approvedNu - activity.committedNu),
    }),
    { approvedNu: 0, utilizedNu: 0, commitmentsNu: 0, committedNu: 0, availableNu: 0 },
  );

  const periodLabel = periods.find((period) => period.value === generated?.month)?.label ?? "";
  const isTdsReport = generated ? ["tds-2", "tds-5"].includes(generated.reportType) : false;
  const reportUsesActivity = !["outstanding-advances", "tds-2", "tds-5"].includes(reportType);
  const isAdministrativeReport = reportType === "budget-balance";
  const activityLabel =
    generated?.reportType === "outstanding-advances"
      ? "All outstanding advance recipients"
      : isTdsReport
        ? "All approved payment vouchers with applicable TDS"
        : generated?.reportType === "budget-balance"
          ? generated.programme === "all"
            ? "All approved programmes"
            : generated.programme
          : generated?.activityId === "all"
            ? "All approved budget activities"
            : (activities.find((activity) => activity.id === Number(generated?.activityId))?.activity ??
              "Selected budget activity");
  const reportTitle = generated ? reportTitles[generated.reportType] : "";
  const reportPeriodLabel = generated?.reportType === "budget-balance" ? fiscalYearLabel(fiscalYear) : periodLabel;

  const generateReport = (event: FormEvent) => {
    event.preventDefault();
    setGenerated({ group: reportGroup, reportType, month, activityId, programme });
  };

  return (
    <>
      <section className="panel report-builder">
        <header className="report-builder-heading">
          <div>
            <span className="eyebrow dark">Financial reports</span>
            <h2>Report selection</h2>
            <p>Select the report group and statement before setting its detailed parameters.</p>
          </div>
          <span className="report-builder-badge">DETAIL REPORT</span>
        </header>

        <form onSubmit={generateReport}>
          <div className="report-selector-grid">
            <label>
              Fiscal Year
              <select
                value={fiscalYear}
                onChange={(event) => {
                  void changeFiscalYear(event.target.value);
                  setActivityId("all");
                  setProgramme("all");
                  setGenerated(null);
                }}
              >
                {fiscalYears.map((year) => (
                  <option key={year} value={year}>
                    {fiscalYearLabel(year)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Group
              <select
                value={reportGroup}
                onChange={(event) => {
                  const nextGroup = event.target.value as ReportGroup;
                  setReportGroup(nextGroup);
                  setReportType(nextGroup === "Administrative" ? "budget-balance" : "expenditure");
                  setActivityId("all");
                  setProgramme("all");
                  setGenerated(null);
                }}
              >
                <option value="Monthly">Monthly</option>
                <option value="Administrative">Administrative</option>
              </select>
            </label>
            <label>
              Report
              <select
                value={reportType}
                onChange={(event) => {
                  setReportType(event.target.value as ReportType);
                  setGenerated(null);
                }}
              >
                {reportGroup === "Administrative" ? (
                  <option value="budget-balance">Budget Balance</option>
                ) : (
                  <>
                    <option value="expenditure">Expenditure Statement</option>
                    <option value="receipts-payments">Receipts and Payments</option>
                    <option value="outstanding-advances">Outstanding Advances</option>
                    <option value="tds-2">2% TDS Schedule</option>
                    <option value="tds-5">5% TDS Schedule</option>
                  </>
                )}
              </select>
            </label>
          </div>

          <section className="report-parameter-section">
            <header>
              <div>
                <span>Step 2</span>
                <h3>Parameter selection</h3>
                <p>
                  {isAdministrativeReport
                    ? "Choose all approved programmes or one programme to view every activity and its available budget for the fiscal year."
                    : reportType === "outstanding-advances"
                      ? "Choose the month-end date for the outstanding advance position."
                      : ["tds-2", "tds-5"].includes(reportType)
                        ? "Choose the month for the approved TDS remittance schedule."
                        : "Choose the month and approved budget activity to include."}
                </p>
              </div>
            </header>
            <div
              className={`report-parameter-grid ${
                !reportUsesActivity ? "advance-parameter-grid" : isAdministrativeReport ? "administrative-parameter-grid" : ""
              }`}
            >
              {isAdministrativeReport ? (
                <div className="advance-report-parameter">
                  <strong>Fiscal year budget position</strong>
                  <span>Approved budget, paid expenditure, commitments and available balance.</span>
                </div>
              ) : (
                <label>
                  {reportType === "outstanding-advances" ? "Outstanding as at" : "Month"}
                  <select
                    value={month}
                    onChange={(event) => {
                      setMonth(event.target.value);
                      setGenerated(null);
                    }}
                  >
                    {periods.map((period) => (
                      <option key={period.value} value={period.value}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!reportUsesActivity ? (
                <div className="advance-report-parameter">
                  <strong>No budget activity parameter required</strong>
                  <span>
                    {reportType === "outstanding-advances"
                      ? "Advances are recorded against the bank and Advance Receivable account only."
                      : "The schedule automatically includes approved payment vouchers at the selected TDS rate."}
                  </span>
                </div>
              ) : isAdministrativeReport ? (
                <label>
                  Programme details
                  <select
                    value={programme}
                    onChange={(event) => {
                      setProgramme(event.target.value);
                      setGenerated(null);
                    }}
                  >
                    <option value="all">All approved programmes</option>
                    {programmes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Budget activity details
                  <select
                    value={activityId}
                    onChange={(event) => {
                      setActivityId(event.target.value);
                      setGenerated(null);
                    }}
                  >
                    <option value="all">All approved budget activities</option>
                    {activities.map((activity) => (
                      <option key={activity.id} value={activity.id}>
                        {activity.obc} · {activity.activity}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button className="primary-button report-generate-button" type="submit">
                Generate and Preview
              </button>
            </div>
          </section>
        </form>
      </section>

      {!generated ? (
        <section className="panel report-empty-preview">
          <span>◔</span>
          <h3>Detailed report preview</h3>
          <p>Select the parameters above, then choose Generate and Preview.</p>
        </section>
      ) : (
        <section className="panel detailed-report-preview">
          <div className="detailed-report-document">
            <header className="detailed-report-heading">
              <div className="detailed-report-logo">
                <PelsungLogo />
              </div>
              <div>
                <span>Pelsung Accounting Management System</span>
                <h2>{reportTitle}</h2>
                <p>
                  {reportPeriodLabel}
                  {generated.reportType === "budget-balance" ? "" : ` · ${fiscalYearLabel(fiscalYear)}`}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Group</dt>
                  <dd>{generated.group}</dd>
                </div>
                <div>
                  <dt>
                    {generated.reportType === "budget-balance" ||
                    generated.reportType === "outstanding-advances" ||
                    isTdsReport
                      ? "Scope"
                      : "Activity"}
                  </dt>
                  <dd>{activityLabel}</dd>
                </div>
                <div>
                  <dt>Generated</dt>
                  <dd>{new Date().toLocaleDateString("en-BT")}</dd>
                </div>
              </dl>
            </header>

            {generated.reportType === "budget-balance" ? (
              <>
                <section className="detailed-report-summary budget-balance-summary">
                  <div>
                    <span>Approved budget</span>
                    <strong>{money.format(balanceTotals.approvedNu)}</strong>
                  </div>
                  <div>
                    <span>Paid expenditure</span>
                    <strong>{money.format(balanceTotals.utilizedNu)}</strong>
                  </div>
                  <div>
                    <span>Approved commitments</span>
                    <strong>{money.format(balanceTotals.commitmentsNu)}</strong>
                  </div>
                  <div>
                    <span>Available balance</span>
                    <strong>{money.format(balanceTotals.availableNu)}</strong>
                  </div>
                </section>
                <div className="detailed-report-table-wrap">
                  <table className="detailed-report-table budget-balance-table">
                    <thead>
                      <tr>
                        <th>Sl.</th>
                        <th>OBC</th>
                        <th>Programme / Category</th>
                        <th>Budget Activity</th>
                        <th>Type</th>
                        <th>Financing</th>
                        <th>Approved Budget (Nu.)</th>
                        <th>Paid Expenditure (Nu.)</th>
                        <th>Approved Commitments (Nu.)</th>
                        <th>Total Committed (Nu.)</th>
                        <th>Available Balance (Nu.)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balanceActivities.map((activity, index) => {
                        const commitmentsNu = Math.max(activity.committedNu - activity.utilizedNu, 0);
                        return (
                          <tr key={activity.id}>
                            <td>{index + 1}</td>
                            <td>
                              <strong className="obc-code">{activity.obc}</strong>
                            </td>
                            <td>{activity.category}</td>
                            <td>
                              <strong>{activity.activity}</strong>
                              <small>{activity.brief}</small>
                            </td>
                            <td>{activity.budgetType}</td>
                            <td>{activity.financing}</td>
                            <td className="amount-cell">{money.format(activity.approvedNu)}</td>
                            <td className="amount-cell">{money.format(activity.utilizedNu)}</td>
                            <td className="amount-cell">{money.format(commitmentsNu)}</td>
                            <td className="amount-cell">{money.format(activity.committedNu)}</td>
                            <td className="amount-cell">
                              <strong>{money.format(activity.approvedNu - activity.committedNu)}</strong>
                            </td>
                          </tr>
                        );
                      })}
                      {!balanceActivities.length && (
                        <tr>
                          <td className="detailed-report-empty" colSpan={11}>
                            No approved budget activities match the selected scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={6}>Budget balance totals</th>
                        <th>{money.format(balanceTotals.approvedNu)}</th>
                        <th>{money.format(balanceTotals.utilizedNu)}</th>
                        <th>{money.format(balanceTotals.commitmentsNu)}</th>
                        <th>{money.format(balanceTotals.committedNu)}</th>
                        <th>{money.format(balanceTotals.availableNu)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : generated.reportType === "expenditure" ? (
              <>
                <section className="detailed-report-summary">
                  <div>
                    <span>Gross expenditure</span>
                    <strong>{money.format(grossExpenditure)}</strong>
                  </div>
                  <div>
                    <span>Authorised reversals</span>
                    <strong>{money.format(expenditureReversals)}</strong>
                  </div>
                  <div>
                    <span>Net expenditure</span>
                    <strong>{money.format(netExpenditure)}</strong>
                  </div>
                  <div>
                    <span>Detailed entries</span>
                    <strong>{previewEntries.length}</strong>
                  </div>
                </section>
                <div className="detailed-report-table-wrap">
                  <table className="detailed-report-table">
                    <thead>
                      <tr>
                        <th>Sl.</th>
                        <th>Date</th>
                        <th>Voucher No.</th>
                        <th>Type</th>
                        <th>GRN/Bill No.</th>
                        <th>Paid To</th>
                        <th>Particulars</th>
                        <th>OBC &amp; Budget Activity</th>
                        <th>Entry / Status</th>
                        <th>Amount (Nu.)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewEntries.map((entry, index) => (
                        <tr className={entry.amountNu < 0 ? "detailed-reversal-row" : ""} key={entry.key}>
                          <td>{index + 1}</td>
                          <td>{voucherDate(entry.date)}</td>
                          <td>
                            <strong>{entry.reference}</strong>
                          </td>
                          <td>{entry.voucherType}</td>
                          <td>{entry.billReference ?? "—"}</td>
                          <td>{entry.payee}</td>
                          <td>{entry.particulars}</td>
                          <td>
                            <strong>{entry.obc}</strong>
                            <small>{entry.activity}</small>
                          </td>
                          <td>
                            {entry.entry}
                            <small>{entry.status}</small>
                          </td>
                          <td className="amount-cell">
                            <strong>{money.format(entry.amountNu)}</strong>
                          </td>
                        </tr>
                      ))}
                      {!previewEntries.length && (
                        <tr>
                          <td className="detailed-report-empty" colSpan={10}>
                            No approved expenditure matches the selected month and budget activity.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={9}>Net expenditure for the selected parameters</th>
                        <th>{money.format(netExpenditure)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : generated.reportType === "receipts-payments" ? (
              <>
                <section className="detailed-report-summary receipts-payments-summary">
                  <div>
                    <span>Total receipts</span>
                    <strong>{money.format(totalReceipts)}</strong>
                  </div>
                  <div>
                    <span>Total payments</span>
                    <strong>{money.format(totalPayments)}</strong>
                  </div>
                  <div>
                    <span>Net cash movement</span>
                    <strong>{money.format(totalReceipts - totalPayments)}</strong>
                  </div>
                  <div>
                    <span>Detailed entries</span>
                    <strong>{previewEntries.length}</strong>
                  </div>
                </section>
                <div className="detailed-report-table-wrap">
                  <table className="detailed-report-table receipts-payments-table">
                    <thead>
                      <tr>
                        <th>Sl.</th>
                        <th>Date</th>
                        <th>Voucher No.</th>
                        <th>GRN/Bill No.</th>
                        <th>Party</th>
                        <th>Particulars</th>
                        <th>OBC &amp; Budget Activity</th>
                        <th>Receipts (Nu.)</th>
                        <th>Payments (Nu.)</th>
                        <th>Entry / Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewEntries.map((entry, index) => (
                        <tr className={entry.amountNu < 0 ? "detailed-reversal-row" : ""} key={entry.key}>
                          <td>{index + 1}</td>
                          <td>{voucherDate(entry.date)}</td>
                          <td>
                            <strong>{entry.reference}</strong>
                          </td>
                          <td>{entry.billReference ?? "—"}</td>
                          <td>{entry.payee}</td>
                          <td>{entry.particulars}</td>
                          <td>
                            <strong>{entry.obc}</strong>
                            <small>{entry.activity}</small>
                          </td>
                          <td className="amount-cell">
                            {entry.direction === "receipt" ? money.format(entry.cashAmountNu) : "—"}
                          </td>
                          <td className="amount-cell">
                            {entry.direction === "payment" ? money.format(entry.cashAmountNu) : "—"}
                          </td>
                          <td>
                            {entry.entry}
                            <small>{entry.status}</small>
                          </td>
                        </tr>
                      ))}
                      {!previewEntries.length && (
                        <tr>
                          <td className="detailed-report-empty" colSpan={10}>
                            No approved receipts or payments match the selected month and budget activity.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={7}>Totals for the selected parameters</th>
                        <th>{money.format(totalReceipts)}</th>
                        <th>{money.format(totalPayments)}</th>
                        <th>Net {money.format(totalReceipts - totalPayments)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : isTdsReport ? (
              <>
                <section className="detailed-report-summary tds-schedule-summary">
                  <div>
                    <span>Gross amount</span>
                    <strong>{money.format(tdsTotals.grossNu)}</strong>
                  </div>
                  <div>
                    <span>Taxable basis after GST</span>
                    <strong>{money.format(tdsTotals.taxableNu)}</strong>
                  </div>
                  <div>
                    <span>TDS to remit</span>
                    <strong>{money.format(tdsTotals.tdsNu)}</strong>
                  </div>
                  <div>
                    <span>Net payments</span>
                    <strong>{money.format(tdsTotals.netNu)}</strong>
                  </div>
                </section>
                <div className="detailed-report-table-wrap">
                  <table className="detailed-report-table tds-schedule-table supplier-tds-table">
                    <thead>
                      <tr>
                        <th>Sl.</th>
                        <th>Date</th>
                        <th>Voucher No.</th>
                        <th>Deductee / Payee</th>
                        <th>TPN</th>
                        <th>GRN/Bill No.</th>
                        <th>Gross (Nu.)</th>
                        <th>GST (Nu.)</th>
                        <th>TDS Basis (Nu.)</th>
                        <th>Rate</th>
                        <th>TDS (Nu.)</th>
                        <th>Net Payment (Nu.)</th>
                        <th>Remittance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tdsEntries.map((voucher, index) => (
                        <tr key={voucher.id}>
                          <td>{index + 1}</td>
                          <td>{voucherDate(voucher.transactionDate)}</td>
                          <td>
                            <strong>{voucher.voucherNumber}</strong>
                          </td>
                          <td>
                            {voucher.payee}
                            <small>{voucher.description}</small>
                          </td>
                          <td>{voucher.tpn || "Not recorded"}</td>
                          <td>{voucher.billReference ?? "—"}</td>
                          <td className="amount-cell">{money.format(voucher.amountNu)}</td>
                          <td className="amount-cell">{money.format(voucher.gstNu)}</td>
                          <td className="amount-cell">{money.format(voucher.amountNu - voucher.gstNu)}</td>
                          <td className="amount-cell">{voucher.tdsRate}%</td>
                          <td className="amount-cell">
                            <strong>{money.format(voucher.tdsNu)}</strong>
                          </td>
                          <td className="amount-cell">{money.format(voucher.netPaymentNu)}</td>
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
                      {!tdsEntries.length && (
                        <tr>
                          <td className="detailed-report-empty" colSpan={13}>
                            No approved {generated.reportType === "tds-2" ? "2%" : "5%"} TDS deductions exist for the
                            selected month.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={6}>Monthly schedule totals</th>
                        <th>{money.format(tdsTotals.grossNu)}</th>
                        <th>{money.format(tdsTotals.gstNu)}</th>
                        <th>{money.format(tdsTotals.taxableNu)}</th>
                        <th>—</th>
                        <th>{money.format(tdsTotals.tdsNu)}</th>
                        <th>{money.format(tdsTotals.netNu)}</th>
                        <th>{unremittedTdsEntries.length ? `${unremittedTdsEntries.length} awaiting` : "Assigned"}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : (
              <>
                <section className="detailed-report-summary outstanding-advance-summary">
                  <div>
                    <span>Total outstanding</span>
                    <strong>{money.format(totalOutstandingAdvances)}</strong>
                  </div>
                  <div>
                    <span>Advance recipients</span>
                    <strong>{outstandingAdvances.length}</strong>
                  </div>
                  <div>
                    <span>Budget impact</span>
                    <strong>Nu. 0</strong>
                  </div>
                  <div>
                    <span>Bank impact</span>
                    <strong>− {money.format(totalOutstandingAdvances)}</strong>
                  </div>
                </section>
                <div className="detailed-report-table-wrap">
                  <table className="detailed-report-table outstanding-advance-table">
                    <thead>
                      <tr>
                        <th>Sl.</th>
                        <th>Advance Date</th>
                        <th>Voucher No.</th>
                        <th>Recipient</th>
                        <th>Reference</th>
                        <th>Purpose / Particulars</th>
                        <th>Original Advance</th>
                        <th>Recovered</th>
                        <th>Outstanding (Nu.)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstandingAdvances.map(({ voucher, recoveredNu, outstandingNu }, index) => (
                        <tr key={voucher.id}>
                          <td>{index + 1}</td>
                          <td>{voucherDate(voucher.transactionDate)}</td>
                          <td>
                            <strong>{voucher.voucherNumber}</strong>
                          </td>
                          <td>{voucher.payee}</td>
                          <td>{voucher.billReference ?? "—"}</td>
                          <td>
                            {voucher.description}
                            <small>1102 · Advance Receivable</small>
                          </td>
                          <td className="amount-cell">{money.format(voucher.amountNu)}</td>
                          <td className="amount-cell">{money.format(recoveredNu)}</td>
                          <td className="amount-cell">
                            <strong>{money.format(outstandingNu)}</strong>
                          </td>
                        </tr>
                      ))}
                      {!outstandingAdvances.length && (
                        <tr>
                          <td className="detailed-report-empty" colSpan={9}>
                            No outstanding advances exist as at the selected month end.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={8}>Total outstanding advances as at {voucherDate(endDate)}</th>
                        <th>{money.format(totalOutstandingAdvances)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}

            <footer className="detailed-report-footer">
              <span>Generated from Pelsung Accounting Management System</span>
              <span>
                {reportPeriodLabel} · {activityLabel}
              </span>
            </footer>
          </div>
          <div className="report-preview-actions">
            <button type="button" className="secondary-button" onClick={() => window.print()}>
              Print detailed report
            </button>
          </div>
        </section>
      )}
    </>
  );
}
