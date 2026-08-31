"use client";

import { useState } from "react";
import { ModalShell, PelsungLogo } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { payBillReference } from "@/lib/fiscal-year";
import { fiscalYearMonthOptions, money, payMonthLabel, scheduleNumber, voucherDate } from "@/lib/format";
import { calculateBhutanMonthlyPayrollTax } from "@/lib/payroll-tax";
import { useApp } from "@/providers/app-provider";
import type { Activity, Employee, PayrollRemittanceRun, PayrollRun, PayrollRunItem } from "@/types";

type PayBillLine = {
  employeeNumber: string;
  fullName: string;
  designation: string;
  department: string;
  cid: string | null;
  tpn: string | null;
  email: string | null;
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  grossPayNu: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  advanceNu: number;
  deductionsNu: number;
};

const emptyTotals = {
  basicPayNu: 0,
  allowancesNu: 0,
  arrearNu: 0,
  grossPayNu: 0,
  taxOnSalaryNu: 0,
  healthContributionNu: 0,
  advanceNu: 0,
  deductionsNu: 0,
  netPayNu: 0,
};

/**
 * Department Pay Bill Report — the schedule attached to the salary voucher.
 *
 * Before finalization it previews live employee figures; afterwards it renders
 * the locked snapshot, so a printed pay bill always matches what was approved.
 */
export function PayBillModal({
  employees,
  payrollRuns,
  payrollRunItems,
  onClose,
  onUndo,
}: {
  employees: Employee[];
  payrollRuns: PayrollRun[];
  payrollRunItems: PayrollRunItem[];
  onClose: () => void;
  onUndo: (run: PayrollRun) => Promise<boolean>;
}) {
  const { fiscalYear, can, run: runAction } = useApp();
  const canFinalize = can("manage_payroll");
  const canUndoPayroll = can("undo_payroll");

  const periods = fiscalYearMonthOptions(fiscalYear);
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [payMonth, setPayMonth] = useState(
    periods.some((period) => period.value === currentMonth) ? currentMonth : periods[0].value,
  );
  const [department, setDepartment] = useState("");

  const departments = [
    ...new Set([
      ...employees.filter((employee) => employee.status === "Active").map((employee) => employee.department),
      ...payrollRuns.map((payrollRun) => payrollRun.department),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const selectedRun = department
    ? payrollRuns.find((payrollRun) => payrollRun.payMonth === payMonth && payrollRun.department === department)
    : undefined;
  const activeEmployees = department
    ? employees
        .filter((employee) => employee.status === "Active" && employee.department === department)
        .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
    : [];
  const finalizedItems = selectedRun ? payrollRunItems.filter((item) => item.payrollRunId === selectedRun.id) : [];
  const reportEmployees: PayBillLine[] = department
    ? selectedRun && finalizedItems.length
      ? finalizedItems
      : activeEmployees
    : [];

  const calculatedTotals = activeEmployees.reduce(
    (total, employee) => ({
      basicPayNu: total.basicPayNu + Number(employee.basicPayNu),
      allowancesNu: total.allowancesNu + Number(employee.allowancesNu),
      arrearNu: total.arrearNu + Number(employee.arrearNu),
      grossPayNu: total.grossPayNu + Number(employee.grossPayNu),
      taxOnSalaryNu: total.taxOnSalaryNu + Number(employee.taxOnSalaryNu),
      healthContributionNu: total.healthContributionNu + Number(employee.healthContributionNu),
      advanceNu: total.advanceNu + Number(employee.advanceNu),
      deductionsNu: total.deductionsNu + Number(employee.deductionsNu),
      netPayNu: total.netPayNu + Number(employee.grossPayNu) - Number(employee.deductionsNu),
    }),
    { ...emptyTotals },
  );

  const totals = selectedRun
    ? {
        basicPayNu: selectedRun.basicPayNu,
        allowancesNu: selectedRun.allowancesNu,
        arrearNu: selectedRun.arrearNu,
        grossPayNu: selectedRun.grossPayNu,
        taxOnSalaryNu: selectedRun.taxOnSalaryNu,
        healthContributionNu: selectedRun.healthContributionNu,
        advanceNu: selectedRun.advanceNu,
        deductionsNu: selectedRun.recoveriesNu,
        netPayNu: selectedRun.netPayNu,
      }
    : calculatedTotals;

  const reference = department ? payBillReference(payMonth, department) : "Not generated";

  const finalize = async () => {
    if (selectedRun || !activeEmployees.length) return;
    const confirmed = window.confirm(
      `Finalize the ${department} pay bill for ${payMonthLabel(payMonth)}?\n\nGross Pay: ${money.format(totals.grossPayNu)}\nTotal Recoveries: ${money.format(totals.deductionsNu)}\nNet Pay: ${money.format(totals.netPayNu)}\n\nOnly this department's employee figures will be locked for the selected month. The budget activity will be selected later during Pay Bill Posting.`,
    );
    if (!confirmed) return;

    await runAction(
      () =>
        api.finalizePayBill({
          fiscalYear,
          payMonth,
          department,
          expectedGrossPayNu: totals.grossPayNu,
          expectedRecoveriesNu: totals.deductionsNu,
          expectedNetPayNu: totals.netPayNu,
        }),
      `${department}'s ${payMonthLabel(payMonth)} pay bill was finalized. Select its approved budget activity during Pay Bill Posting.`,
    );
  };

  return (
    <ModalShell className="paybill-backdrop" onClose={onClose}>
      <article
        className="paybill-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Department Pay Bill Report for ${department || "selected department"}`}
      >
        <div className="paybill-period-toolbar">
          <div className="paybill-period-fields">
            <label>
              Pay month
              <select value={payMonth} onChange={(event) => setPayMonth(event.target.value)}>
                {periods.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Department
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                disabled={!departments.length}
              >
                <option value="">Select department</option>
                {departments.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="paybill-period-status">
            {selectedRun ? (
              <span className={`status ${selectedRun.status === "Posted" ? "status-approved" : "status-pending"}`}>
                <i />
                {selectedRun.postingUndoneAt ? "Posting Undone" : selectedRun.status}
              </span>
            ) : (
              <span className="paybill-draft-status">{department ? "Ready for review" : "Department required"}</span>
            )}
            <small>
              {selectedRun
                ? selectedRun.postingUndoneAt && canUndoPayroll
                  ? "Posting was undone · pay bill can now be un-finalized"
                  : `Locked ${voucherDate(selectedRun.finalizedAt)} by ${selectedRun.finalizedByName ?? "Payroll user"}`
                : department
                  ? canFinalize
                    ? "Review this department before finalizing"
                    : "Read-only pay bill preview"
                  : "Select a department to display employees"}
            </small>
          </div>
        </div>

        <div className="paybill-document">
          <header className="paybill-header">
            <div className="paybill-logo">
              <PelsungLogo />
            </div>
            <div>
              <span>Pelsung Finance</span>
              <h2>Department Pay Bill Report</h2>
              <p>Supporting schedule for attachment to the department salary voucher</p>
            </div>
            <dl>
              <div>
                <dt>Pay period</dt>
                <dd>{payMonthLabel(payMonth)}</dd>
              </div>
              <div>
                <dt>Report reference</dt>
                <dd>{reference}</dd>
              </div>
            </dl>
          </header>

          <section className="paybill-meta">
            <div>
              <span>Department</span>
              <strong>{department || "Not selected"}</strong>
            </div>
            <div>
              <span>Employees included</span>
              <strong>{reportEmployees.length}</strong>
            </div>
            <div>
              <span>Pay bill status</span>
              <strong>{selectedRun?.postingUndoneAt ? "Posting Undone" : (selectedRun?.status ?? "Under review")}</strong>
            </div>
          </section>

          <div className="paybill-table-wrap">
            <table className="paybill-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Sl.</th>
                  <th rowSpan={2}>Employee ID</th>
                  <th rowSpan={2}>Employee particulars</th>
                  <th colSpan={4}>Earnings (Nu.)</th>
                  <th colSpan={4}>Deductions (Nu.)</th>
                  <th rowSpan={2}>Net Pay (Nu.)</th>
                </tr>
                <tr>
                  <th>Basic Pay</th>
                  <th>Allowances</th>
                  <th>Arrear</th>
                  <th>Gross Pay</th>
                  <th>Salary Tax</th>
                  <th>Health 1%</th>
                  <th>Advance</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {reportEmployees.map((employee, index) => (
                  <tr key={employee.employeeNumber}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{employee.employeeNumber}</strong>
                    </td>
                    <td className="paybill-employee-cell">
                      <strong>{employee.fullName}</strong>
                      <small>
                        {employee.designation} · {employee.department}
                      </small>
                      <small>
                        CID {employee.cid || "Not recorded"} · TPN {employee.tpn || "Not recorded"}
                      </small>
                      <small>Email {employee.email || "Not recorded"}</small>
                    </td>
                    <td className="amount-cell">{money.format(employee.basicPayNu)}</td>
                    <td className="amount-cell">{money.format(employee.allowancesNu)}</td>
                    <td className="amount-cell">{money.format(employee.arrearNu)}</td>
                    <td className="amount-cell">
                      <strong>{money.format(employee.grossPayNu)}</strong>
                    </td>
                    <td className="amount-cell">{money.format(employee.taxOnSalaryNu)}</td>
                    <td className="amount-cell">{money.format(employee.healthContributionNu)}</td>
                    <td className="amount-cell">{money.format(employee.advanceNu)}</td>
                    <td className="amount-cell">
                      <strong>{money.format(employee.deductionsNu)}</strong>
                    </td>
                    <td className="amount-cell paybill-net-cell">
                      <strong>{money.format(employee.grossPayNu - employee.deductionsNu)}</strong>
                    </td>
                  </tr>
                ))}
                {!department ? (
                  <tr>
                    <td colSpan={12} className="detailed-report-empty">
                      Select a department to display its employees.
                    </td>
                  </tr>
                ) : (
                  !reportEmployees.length && (
                    <tr>
                      <td colSpan={12} className="detailed-report-empty">
                        No active employees are available in the selected department.
                      </td>
                    </tr>
                  )
                )}
                {department && (
                  <tr className="paybill-total-row">
                    <td colSpan={3}>Grand Total</td>
                    <td>{money.format(totals.basicPayNu)}</td>
                    <td>{money.format(totals.allowancesNu)}</td>
                    <td>{money.format(totals.arrearNu)}</td>
                    <td>{money.format(totals.grossPayNu)}</td>
                    <td>{money.format(totals.taxOnSalaryNu)}</td>
                    <td>{money.format(totals.healthContributionNu)}</td>
                    <td>{money.format(totals.advanceNu)}</td>
                    <td>{money.format(totals.deductionsNu)}</td>
                    <td>{money.format(totals.netPayNu)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <section className="paybill-summary">
            <div>
              <span>Total Gross Pay</span>
              <strong>{money.format(totals.grossPayNu)}</strong>
            </div>
            <div>
              <span>Total Deductions</span>
              <strong>{money.format(totals.deductionsNu)}</strong>
            </div>
            <div className="paybill-summary-net">
              <span>Net Salary Payable</span>
              <strong>{money.format(totals.netPayNu)}</strong>
            </div>
          </section>

          <footer className="paybill-certification">
            <div>
              <strong>Certification</strong>
              <p>
                Certified that the employee status, earnings and deductions shown for{" "}
                {department || "the selected department"} have been checked against the payroll register. The approved
                budget activity will be selected during Pay Bill Posting.
              </p>
            </div>
            <div className="paybill-signature">
              <i />
              <span>Head of Finance</span>
              <small>Date: __________________</small>
            </div>
          </footer>
          <p className="paybill-print-note">Print setting: A4 landscape orientation is recommended.</p>
        </div>

        <div className="paybill-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="secondary-button" disabled={!department} onClick={() => window.print()}>
            Print Department Pay Bill
          </button>
          {selectedRun?.status === "Finalized" && selectedRun.postingUndoneAt && canUndoPayroll && (
            <button type="button" className="payroll-undo-button" onClick={() => void onUndo(selectedRun)}>
              Un-finalize Pay Bill
            </button>
          )}
          {canFinalize && (
            <button
              type="button"
              className="primary-button"
              disabled={Boolean(selectedRun) || !department || !activeEmployees.length}
              onClick={() => void finalize()}
            >
              {selectedRun
                ? selectedRun.status === "Posted"
                  ? "Pay Bill Posted"
                  : selectedRun.postingUndoneAt
                    ? "Posting Undone"
                    : "Pay Bill Finalized"
                : "Finalize Department Pay Bill"}
            </button>
          )}
        </div>
      </article>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Pay Bill Posting                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Charges a finalized pay bill to an approved budget activity and generates the
 * combined payroll voucher. Posting is refused unless gross pay balances
 * against recoveries plus net pay and fits the activity's available budget.
 */
export function PayBillPostingModal({
  payrollRuns,
  activities,
  onClose,
  onPosted,
  onUndo,
}: {
  payrollRuns: PayrollRun[];
  activities: Activity[];
  onClose: () => void;
  onPosted: () => void;
  onUndo: (run: PayrollRun) => Promise<boolean>;
}) {
  const { fiscalYear, can, run: runAction } = useApp();
  const canUndoPayroll = can("undo_payroll");
  const periods = fiscalYearMonthOptions(fiscalYear);
  const firstRun = payrollRuns.find((payrollRun) => payrollRun.status === "Finalized") ?? payrollRuns[0];

  const [payMonth, setPayMonth] = useState(firstRun?.payMonth ?? periods[0].value);
  const [department, setDepartment] = useState(firstRun?.department ?? "");
  const [budgetActivityId, setBudgetActivityId] = useState(firstRun?.budgetActivityId ?? activities[0]?.id ?? 0);

  const runsForMonth = payrollRuns.filter((payrollRun) => payrollRun.payMonth === payMonth);
  const selectedRun = runsForMonth.find((payrollRun) => payrollRun.department === department);
  const selectedActivity = activities.find((activity) => activity.id === budgetActivityId);
  const availableBudgetNu =
    selectedRun?.status === "Posted"
      ? selectedRun.budgetActivityAvailableNu
      : selectedActivity
        ? selectedActivity.approvedNu - selectedActivity.committedNu
        : null;

  const changePayMonth = (nextMonth: string) => {
    setPayMonth(nextMonth);
    const nextRuns = payrollRuns.filter((payrollRun) => payrollRun.payMonth === nextMonth);
    const nextRun = nextRuns.find((payrollRun) => payrollRun.status === "Finalized") ?? nextRuns[0];
    setDepartment(nextRun?.department ?? "");
    setBudgetActivityId(nextRun?.budgetActivityId ?? activities[0]?.id ?? 0);
  };

  const changeDepartment = (nextDepartment: string) => {
    setDepartment(nextDepartment);
    const nextRun = runsForMonth.find((payrollRun) => payrollRun.department === nextDepartment);
    setBudgetActivityId(nextRun?.budgetActivityId ?? activities[0]?.id ?? 0);
  };

  const post = async () => {
    if (!selectedRun || selectedRun.status !== "Finalized" || !selectedActivity) return;
    const confirmed = window.confirm(
      `Post the finalized ${department} pay bill for ${payMonthLabel(payMonth)}?\n\nOne combined Payroll Payment Voucher will charge Gross Pay to ${selectedActivity.obc} · ${selectedActivity.activity}, recognize all recoveries and post Net Pay to the bank.`,
    );
    if (!confirmed) return;

    const posted = await runAction(
      () => api.postPayBill({ fiscalYear, payMonth, department, budgetActivityId: selectedActivity.id }),
      `${department}'s ${payMonthLabel(payMonth)} pay bill was posted against ${selectedActivity.obc} · ${selectedActivity.activity}. One combined payroll voucher was saved as Draft; submit it from Vouchers for approval.`,
    );
    if (posted) onPosted();
  };

  const postingCheckPassed =
    selectedRun &&
    selectedActivity &&
    availableBudgetNu !== null &&
    selectedRun.grossPayNu === selectedRun.recoveriesNu + selectedRun.netPayNu &&
    selectedRun.grossPayNu <= availableBudgetNu;

  return (
    <ModalShell className="paybill-posting-backdrop" onClose={onClose}>
      <article className="modal-card paybill-posting-card" role="dialog" aria-modal="true" aria-label="Pay Bill Posting">
        <header>
          <div>
            <span className="eyebrow dark">Payroll Module</span>
            <h2>Pay Bill Posting</h2>
            <p>
              Select a finalized month, department and approved budget activity. The locked payroll totals are fetched
              automatically.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="paybill-posting-body">
          <div className="paybill-posting-selectors">
            <label>
              Pay month
              <select value={payMonth} onChange={(event) => changePayMonth(event.target.value)}>
                {periods.map((period) => {
                  const count = payrollRuns.filter((payrollRun) => payrollRun.payMonth === period.value).length;
                  return (
                    <option key={period.value} value={period.value}>
                      {period.label}
                      {count ? ` · ${count} department${count === 1 ? "" : "s"}` : " · Not finalized"}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Department
              <select
                value={department}
                onChange={(event) => changeDepartment(event.target.value)}
                disabled={!runsForMonth.length}
              >
                {runsForMonth.length ? (
                  runsForMonth.map((payrollRun) => (
                    <option key={payrollRun.id} value={payrollRun.department}>
                      {payrollRun.department} · {payrollRun.status}
                    </option>
                  ))
                ) : (
                  <option value="">No finalized department</option>
                )}
              </select>
            </label>
            <label>
              Approved budget activity
              <select
                value={budgetActivityId}
                onChange={(event) => setBudgetActivityId(Number(event.target.value))}
                disabled={!selectedRun || selectedRun.status === "Posted" || !activities.length}
              >
                {activities.length ? (
                  activities.map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activity.obc} · {activity.activity} ({activity.category}) · Available{" "}
                      {money.format(activity.approvedNu - activity.committedNu)}
                    </option>
                  ))
                ) : (
                  <option value={0}>No approved activities</option>
                )}
              </select>
            </label>
          </div>

          {!selectedRun ? (
            <div className="paybill-posting-empty">
              <span>!</span>
              <div>
                <strong>Department pay bill not finalized</strong>
                <p>Generate and finalize a department pay bill for {payMonthLabel(payMonth)} before posting.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="paybill-posting-source">
                <div>
                  <span>Pay bill reference</span>
                  <strong>{payBillReference(payMonth, department)}</strong>
                </div>
                <div>
                  <span>Department</span>
                  <strong>{department}</strong>
                </div>
                <div>
                  <span>Budget activity</span>
                  <strong>{selectedActivity?.obc ?? "Not selected"}</strong>
                  <small>
                    {selectedActivity
                      ? `${selectedActivity.activity} (${selectedActivity.category})`
                      : "Select an approved activity"}
                  </small>
                </div>
                <div>
                  <span>Available budget</span>
                  <strong>{availableBudgetNu === null ? "—" : money.format(availableBudgetNu)}</strong>
                </div>
                <div>
                  <span>Employees / status</span>
                  <strong>{selectedRun.employeeCount}</strong>
                  <small>{selectedRun.postingUndoneAt ? "Posting Undone" : selectedRun.status}</small>
                </div>
              </div>

              <section className="paybill-posting-totals">
                <div>
                  <span>Total Gross Pay</span>
                  <strong>{money.format(selectedRun.grossPayNu)}</strong>
                  <small>Payroll expense</small>
                </div>
                <div>
                  <span>Total Recoveries</span>
                  <strong>{money.format(selectedRun.recoveriesNu)}</strong>
                  <small>Tax, health contribution and advance</small>
                </div>
                <div>
                  <span>Net Pay</span>
                  <strong>{money.format(selectedRun.netPayNu)}</strong>
                  <small>Bank payment</small>
                </div>
              </section>

              <div className="paybill-balance-check">
                <span>Posting check</span>
                <strong>
                  {postingCheckPassed
                    ? "Budget available · Gross Pay = Recoveries + Net Pay ✓"
                    : "Select a sufficient budget activity and confirm the pay bill is in balance"}
                </strong>
              </div>

              {selectedRun.status === "Posted" && (
                <div className="paybill-posted-vouchers">
                  <strong>Generated voucher</strong>
                  <span>{selectedRun.voucherNumbers ?? "Voucher reference is being refreshed."}</span>
                </div>
              )}
            </>
          )}
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          {selectedRun?.status === "Posted" && canUndoPayroll && (
            <button type="button" className="payroll-undo-button" onClick={() => void onUndo(selectedRun)}>
              Undo Pay Bill Posting
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            disabled={!selectedRun || selectedRun.status !== "Finalized" || !postingCheckPassed}
            onClick={() => void post()}
          >
            {selectedRun?.status === "Posted" ? "Already Posted" : "Save and Generate Payroll Voucher"}
          </button>
        </footer>
      </article>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Monthly TDS & Health Contribution remittance (Form IT-1(a))                */
/* -------------------------------------------------------------------------- */

export function TdsScheduleModal({
  payrollRuns,
  payrollRunItems,
  remittanceRuns,
  onClose,
  onPosted,
}: {
  payrollRuns: PayrollRun[];
  payrollRunItems: PayrollRunItem[];
  remittanceRuns: PayrollRemittanceRun[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const { fiscalYear, run: runAction } = useApp();
  const periods = fiscalYearMonthOptions(fiscalYear);
  const [payMonth, setPayMonth] = useState("");

  const monthRuns = payMonth
    ? payrollRuns.filter((payrollRun) => payrollRun.payMonth === payMonth && payrollRun.status === "Posted")
    : [];
  const runIds = new Set(monthRuns.map((payrollRun) => payrollRun.id));
  const scheduleEmployees = payMonth
    ? payrollRunItems
        .filter((item) => runIds.has(item.payrollRunId))
        .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber))
    : [];
  const remittanceRun = remittanceRuns.find((item) => item.payMonth === payMonth);

  // Each posted department must have all of its generated vouchers approved.
  const salaryPaid =
    monthRuns.length > 0 &&
    monthRuns.every(
      (payrollRun) => [1, 3].includes(payrollRun.voucherCount) && payrollRun.approvedVoucherCount === payrollRun.voucherCount,
    );

  const totals = scheduleEmployees.reduce(
    (total, employee) => {
      const taxBasis = calculateBhutanMonthlyPayrollTax(employee.grossPayNu);
      return {
        basicPayNu: total.basicPayNu + Number(employee.basicPayNu),
        allowancesNu: total.allowancesNu + Number(employee.allowancesNu),
        arrearNu: total.arrearNu + Number(employee.arrearNu),
        grossPayNu: total.grossPayNu + Number(employee.grossPayNu),
        providentFundNu: total.providentFundNu + taxBasis.providentFundNu,
        tdsBasisNu: total.tdsBasisNu + taxBasis.tdsBasisNu,
        taxOnSalaryNu: total.taxOnSalaryNu + Number(employee.taxOnSalaryNu),
        healthContributionNu: total.healthContributionNu + Number(employee.healthContributionNu),
        remittanceNu: total.remittanceNu + Number(employee.taxOnSalaryNu) + Number(employee.healthContributionNu),
      };
    },
    {
      basicPayNu: 0,
      allowancesNu: 0,
      arrearNu: 0,
      grossPayNu: 0,
      providentFundNu: 0,
      tdsBasisNu: 0,
      taxOnSalaryNu: 0,
      healthContributionNu: 0,
      remittanceNu: 0,
    },
  );

  const finalize = async () => {
    const confirmed = window.confirm(
      `Finalize TDS and Health Contribution remittance for ${payMonthLabel(payMonth)} and generate its Draft Payment Voucher?\n\nTDS: ${money.format(totals.taxOnSalaryNu)}\nHealth Contribution: ${money.format(totals.healthContributionNu)}\nTotal: ${money.format(totals.remittanceNu)}\n\nThe generated voucher must be submitted from Vouchers for approval.`,
    );
    if (!confirmed) return;

    const finalized = await runAction(
      () => api.finalizePayrollRemittance({ fiscalYear, payMonth }),
      `${payMonthLabel(payMonth)} TDS and Health Contribution remittance was finalized. One remittance Payment Voucher was generated as Draft; submit it from Vouchers for approval.`,
    );
    if (finalized) onPosted();
  };

  const post = async () => {
    const confirmed = window.confirm(
      `Post ${payMonthLabel(payMonth)} TDS and Health Contribution remittance? A Payment Voucher for ${money.format(remittanceRun?.totalRemittanceNu ?? totals.remittanceNu)} will be generated automatically.`,
    );
    if (!confirmed) return;

    const posted = await runAction(
      () => api.postPayrollRemittance({ fiscalYear, payMonth }),
      `${payMonthLabel(payMonth)} TDS and Health Contribution remittance was saved. Its Payment Voucher is in Draft; submit it from Vouchers for approval.`,
    );
    if (posted) onPosted();
  };

  return (
    <ModalShell className="tds-schedule-backdrop" onClose={onClose}>
      <article
        className="tds-schedule-card"
        role="dialog"
        aria-modal="true"
        aria-label="Monthly TDS and Health Contribution Remittance"
      >
        <div className="tds-schedule-document">
          <section className="paybill-posting-controls">
            <label>
              Salary month
              <select value={payMonth} onChange={(event) => setPayMonth(event.target.value)}>
                <option value="">Select month</option>
                {periods.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="paybill-posting-stage">
              <span>Procedure</span>
              <strong>
                {remittanceRun?.status === "Posted"
                  ? "Finalized · Draft voucher generated"
                  : remittanceRun
                    ? "Existing finalization · ready to generate voucher"
                    : salaryPaid
                      ? "Paid salary verified · ready to finalize and generate voucher"
                      : "Awaiting approved salary vouchers"}
              </strong>
            </div>
          </section>

          <header className="tds-schedule-heading">
            <div className="tds-schedule-logo">
              <PelsungLogo />
            </div>
            <div>
              <span>Pelsung Finance · Payroll</span>
              <h2>TDS &amp; Health Contribution Remittance</h2>
              <p>Monthly withholding schedule prepared from finalized and paid salary records</p>
            </div>
            <dl>
              <div>
                <dt>Tax period</dt>
                <dd>{payMonth ? payMonthLabel(payMonth) : "Select month"}</dd>
              </div>
              <div>
                <dt>Form</dt>
                <dd>IT-1(a)</dd>
              </div>
            </dl>
          </header>

          <section className="tds-schedule-meta">
            <div>
              <span>Employer / Agency</span>
              <strong>Pelsung</strong>
            </div>
            <div>
              <span>Employer TPN</span>
              <strong>________________</strong>
            </div>
            <div>
              <span>Remittance reference</span>
              <strong>________________</strong>
            </div>
            <div>
              <span>Employees reported</span>
              <strong>{scheduleEmployees.length}</strong>
            </div>
          </section>

          <h3 className="it1a-title">FORM IT-1(a) MONTHLY SALARY SCHEDULE</h3>
          <div className="tds-schedule-table-wrap">
            <table className="tds-schedule-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Name of Employee</th>
                  <th rowSpan={2}>TPN</th>
                  {Array.from({ length: 10 }, (_, index) => (
                    <th key={index}>{index + 1}</th>
                  ))}
                </tr>
                <tr>
                  <th>Basic Salary</th>
                  <th>Benefit / Allowance</th>
                  <th>Salary Arrear</th>
                  <th>Gross Salary</th>
                  <th className="it1a-deduction-head">Provident Fund (PF) / Nil</th>
                  <th className="it1a-deduction-head">Group Insurance Scheme (GIS) / Zero</th>
                  <th>TDS Basis (Gross Salary − 15%)</th>
                  <th>Annexure I TDS</th>
                  <th>Health Contribution (1% of Gross Salary)</th>
                  <th>Total (8 + 9)</th>
                </tr>
              </thead>
              <tbody>
                {scheduleEmployees.map((employee) => {
                  const taxBasis = calculateBhutanMonthlyPayrollTax(employee.grossPayNu);
                  return (
                    <tr key={employee.id}>
                      <td>
                        <strong>{employee.fullName}</strong>
                        <small>
                          {employee.employeeNumber} · {employee.designation}
                        </small>
                      </td>
                      <td>{employee.tpn || "Not recorded"}</td>
                      <td>{scheduleNumber.format(employee.basicPayNu)}</td>
                      <td>{scheduleNumber.format(employee.allowancesNu)}</td>
                      <td>{scheduleNumber.format(employee.arrearNu)}</td>
                      <td>
                        <strong>{scheduleNumber.format(employee.grossPayNu)}</strong>
                      </td>
                      <td>{scheduleNumber.format(taxBasis.providentFundNu)}</td>
                      <td>0</td>
                      <td>{scheduleNumber.format(taxBasis.tdsBasisNu)}</td>
                      <td>{scheduleNumber.format(employee.taxOnSalaryNu)}</td>
                      <td>{scheduleNumber.format(employee.healthContributionNu)}</td>
                      <td className="tds-remittance-cell">
                        <strong>
                          {scheduleNumber.format(employee.taxOnSalaryNu + employee.healthContributionNu)}
                        </strong>
                      </td>
                    </tr>
                  );
                })}
                {!scheduleEmployees.length && (
                  <tr>
                    <td colSpan={12} className="detailed-report-empty">
                      Select a month with posted department pay bills to display the locked salary schedule.
                    </td>
                  </tr>
                )}
                <tr className="tds-schedule-total">
                  <td colSpan={2}>Grand Total (Nu.)</td>
                  <td>{scheduleNumber.format(totals.basicPayNu)}</td>
                  <td>{scheduleNumber.format(totals.allowancesNu)}</td>
                  <td>{scheduleNumber.format(totals.arrearNu)}</td>
                  <td>{scheduleNumber.format(totals.grossPayNu)}</td>
                  <td>{scheduleNumber.format(totals.providentFundNu)}</td>
                  <td>0</td>
                  <td>{scheduleNumber.format(totals.tdsBasisNu)}</td>
                  <td>{scheduleNumber.format(totals.taxOnSalaryNu)}</td>
                  <td>{scheduleNumber.format(totals.healthContributionNu)}</td>
                  <td>{scheduleNumber.format(totals.remittanceNu)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <section className="tds-remittance-summary">
            <div>
              <span>Salary TDS to remit</span>
              <strong>{money.format(totals.taxOnSalaryNu)}</strong>
            </div>
            <div>
              <span>Health Contribution to remit</span>
              <strong>{money.format(totals.healthContributionNu)}</strong>
            </div>
            <div className="tds-remittance-total">
              <span>Total monthly remittance</span>
              <strong>{money.format(totals.remittanceNu)}</strong>
            </div>
          </section>

          <section className="tds-schedule-note">
            <strong>Calculation basis</strong>
            <p>
              Column 5 is Nil because Pelsung does not operate a Provident Fund and Column 6 is zero GIS. Under Rule 153,
              Column 7 is Gross Salary reduced by the 15% specific deduction. Column 8 applies Annexure I to that basis,
              Column 9 uses Health Contribution at 1% of Gross Salary, and Column 10 is the TDS plus Health Contribution
              payable for remittance.
            </p>
          </section>
          {!salaryPaid && payMonth && monthRuns.length > 0 && (
            <section className="tds-schedule-note">
              <strong>Salary approval required</strong>
              <p>Approve the generated Payroll Payment Voucher for every department before finalizing this remittance.</p>
            </section>
          )}
          {remittanceRun?.voucherNumbers && (
            <section className="paybill-posted-vouchers">
              <strong>Generated remittance voucher</strong>
              <span>{remittanceRun.voucherNumbers}</span>
            </section>
          )}

          <footer className="tds-schedule-certification">
            <div>
              <strong>Certified correct for monthly remittance</strong>
              <p>
                The schedule has been prepared from locked payroll snapshots whose salary vouchers completed approval.
              </p>
            </div>
            <div>
              <i />
              <span>Head of Finance</span>
              <small>Date: __________________</small>
            </div>
          </footer>
          <p className="tds-schedule-print-note">Print setting: A4 landscape orientation is recommended.</p>
        </div>

        <div className="tds-schedule-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!scheduleEmployees.length}
            onClick={() => window.print()}
          >
            Print Schedule
          </button>
          {!remittanceRun && (
            <button
              type="button"
              className="primary-button"
              disabled={!payMonth || !salaryPaid || totals.remittanceNu <= 0}
              onClick={() => void finalize()}
            >
              Finalize TDS &amp; HC and Generate Voucher
            </button>
          )}
          {remittanceRun?.status === "Finalized" && (
            <button type="button" className="primary-button" onClick={() => void post()}>
              Generate Voucher for Existing Finalization
            </button>
          )}
          {remittanceRun?.status === "Posted" && (
            <button type="button" className="primary-button" disabled>
              Draft Voucher Generated
            </button>
          )}
        </div>
      </article>
    </ModalShell>
  );
}
