"use client";

import { useMemo, useState } from "react";
import { DepartmentManagementModal, EmployeeModal, PayslipModal } from "@/components/payroll/employee-modals";
import { PayBillModal, PayBillPostingModal, TdsScheduleModal } from "@/components/payroll/paybill-modals";
import { RouteGuard } from "@/components/shell/route-guard";
import { Empty, ModuleHero } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { currentBhutanMonth, fiscalYearMonthOptions, money, payMonthLabel } from "@/lib/format";
import { useApp } from "@/providers/app-provider";
import type { AccountingData, Employee, PayrollRun } from "@/types";

export default function PayrollPage() {
  return <RouteGuard permission="view_payroll">{(data) => <PayrollModule data={data} />}</RouteGuard>;
}

type OpenModal = "department" | "payBill" | "posting" | "tdsSchedule" | null;

function PayrollModule({ data }: { data: AccountingData }) {
  const { fiscalYear, can, run } = useApp();
  const { employees, departments, payrollRuns, payrollRunItems, payrollRemittanceRuns, activities } = data;

  const canManage = can("add_employee");
  const canManageDepartments = can("manage_departments");
  const canOperatePayroll = can("manage_payroll");
  const canUndoPayroll = can("undo_payroll");

  const [modal, setModal] = useState<OpenModal>(null);
  const [employeeModal, setEmployeeModal] = useState<Employee | "new" | null>(null);
  const [payslipEmployee, setPayslipEmployee] = useState<Employee | null>(null);
  const [recentEmployeeNumber, setRecentEmployeeNumber] = useState("");
  const [selectedPayMonth, setSelectedPayMonth] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");

  const payrollPeriods = useMemo(() => fiscalYearMonthOptions(fiscalYear), [fiscalYear]);
  const allActiveEmployees = employees.filter((employee) => employee.status === "Active");
  const selectionReady = Boolean(selectedPayMonth && selectedDepartment);
  const visibleEmployees = selectionReady
    ? employees.filter((employee) => employee.department === selectedDepartment)
    : [];
  const visiblePayrollRuns = selectionReady
    ? payrollRuns.filter(
        (payrollRun) => payrollRun.payMonth === selectedPayMonth && payrollRun.department === selectedDepartment,
      )
    : [];
  const activeEmployees = visibleEmployees.filter((employee) => employee.status === "Active");
  const gross = activeEmployees.reduce((sum, employee) => sum + Number(employee.grossPayNu), 0);
  const deductions = activeEmployees.reduce((sum, employee) => sum + Number(employee.deductionsNu), 0);
  const finalizedRuns = payrollRuns.filter((payrollRun) => payrollRun.status === "Finalized");

  /**
   * Undo is a two-stage control: posting first (which removes the generated
   * vouchers), then the finalized snapshot. Each stage confirms its effect.
   */
  const undoPayBill = async (payrollRun: PayrollRun): Promise<boolean> => {
    const isPosted = payrollRun.status === "Posted";
    if (!isPosted && !payrollRun.postingUndoneAt) {
      window.alert("Un-finalize Pay Bill is available only after Pay Bill Posting has been undone.");
      return false;
    }

    const confirmed = window.confirm(
      isPosted
        ? `Undo Pay Bill Posting for ${payrollRun.department} · ${payMonthLabel(payrollRun.payMonth)}?\n\nPending or Rejected generated vouchers will be removed. Reversed vouchers will remain in accounting history. Any Approved voucher must be reversed first. After this step, Un-finalize Pay Bill will become available.`
        : `Un-finalize Pay Bill for ${payrollRun.department} · ${payMonthLabel(payrollRun.payMonth)}?\n\nPay Bill Posting has already been undone. The locked payroll snapshot will now be removed so the department pay bill can be reviewed and finalized again.`,
    );
    if (!confirmed) return false;

    const payload = { fiscalYear, payMonth: payrollRun.payMonth, department: payrollRun.department };
    return run(
      () => (isPosted ? api.undoPayBillPosting(payload) : api.unfinalizePayBill(payload)),
      isPosted
        ? `${payrollRun.department}'s ${payMonthLabel(payrollRun.payMonth)} posting was undone. Un-finalize Pay Bill is now available.`
        : `${payrollRun.department}'s ${payMonthLabel(payrollRun.payMonth)} pay bill was un-finalized and is ready for review and finalization again.`,
    );
  };

  const setEmployeeStatus = async (employee: Employee, status: "Active" | "Inactive") =>
    run(
      () => api.setEmployeeStatus(employee.id, status, fiscalYear),
      `${employee.fullName} is now ${status.toLocaleLowerCase()}.`,
    );

  return (
    <>
      <ModuleHero
        eyebrow="Payroll Module"
        title="Employee master"
        description="Select a month and payroll department to view its pay bill status and employee register."
        actions={
          <>
            {canManageDepartments && (
              <button className="secondary-button department-management-button" onClick={() => setModal("department")}>
                ＋ Manage departments
              </button>
            )}
            <button
              className="secondary-button"
              onClick={() => setModal("payBill")}
              disabled={!allActiveEmployees.length}
              title={
                allActiveEmployees.length
                  ? canOperatePayroll
                    ? "Generate, print and finalize a monthly pay bill"
                    : "View and print a monthly pay bill"
                  : "No active employees are available for this report"
              }
            >
              ▣ Pay Bill Report
            </button>
            {canOperatePayroll && (
              <>
                <button
                  className="secondary-button payroll-posting-button"
                  onClick={() => setModal("posting")}
                  disabled={!payrollRuns.length}
                  title={
                    payrollRuns.length
                      ? "Post a finalized monthly pay bill to the Voucher module"
                      : "Finalize a monthly pay bill before posting"
                  }
                >
                  ⇄ Pay Bill Posting{finalizedRuns.length ? ` (${finalizedRuns.length})` : ""}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setModal("tdsSchedule")}
                  disabled={!payrollRuns.some((payrollRun) => payrollRun.status === "Posted")}
                  title={
                    payrollRuns.some((payrollRun) => payrollRun.status === "Posted")
                      ? "Prepare, finalize and post monthly TDS and HC remittance"
                      : "Post a salary pay bill before preparing remittance"
                  }
                >
                  % TDS &amp; HC Remittance
                </button>
              </>
            )}
            {canManage && (
              <button
                className="primary-button"
                onClick={() => setEmployeeModal("new")}
                disabled={!departments.length}
                title={departments.length ? "Add an employee" : "An Admin must add a department first"}
              >
                ＋ Add employee
              </button>
            )}
          </>
        }
      />

      {!departments.length && (
        <section className="department-empty-notice">
          <span>Department setup required</span>
          <p>An Admin must add at least one department before employees can be registered.</p>
          {canManageDepartments && (
            <button type="button" onClick={() => setModal("department")}>
              Add the first department →
            </button>
          )}
        </section>
      )}

      <section className="panel payroll-register-selection" aria-label="Payroll register selection">
        <div>
          <span className="eyebrow dark">Payroll selection</span>
          <h3>Select the payroll period</h3>
          <p>The pay bill status and employee register appear only after both selections are completed.</p>
        </div>
        <div className="payroll-register-fields">
          <label>
            Month
            <select value={selectedPayMonth} onChange={(event) => setSelectedPayMonth(event.target.value)}>
              <option value="">Select month</option>
              {payrollPeriods.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payroll Department
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              disabled={!departments.length}
            >
              <option value="">Select payroll department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.name}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {!selectionReady && (
        <section className="payroll-selection-prompt">
          <span>Month and Payroll Department required</span>
          <p>Select both fields above to display Department Pay Bill Status and the Payroll Employee Register.</p>
        </section>
      )}

      {selectionReady && (
        <>
          <section className="register-summary payroll-summary">
            <div>
              <span>Active employees</span>
              <strong>{activeEmployees.length}</strong>
            </div>
            <div>
              <span>Gross pay</span>
              <strong>{money.format(gross)}</strong>
            </div>
            <div>
              <span>Deductions</span>
              <strong>{money.format(deductions)}</strong>
            </div>
            <div>
              <span>Net pay</span>
              <strong>{money.format(gross - deductions)}</strong>
            </div>
          </section>

          <section className="panel payroll-run-register">
            <div className="register-toolbar">
              <div>
                <h3>Department pay bill status</h3>
                <p>
                  {payMonthLabel(selectedPayMonth)} · {selectedDepartment}. Un-finalize becomes available only after Pay
                  Bill Posting is undone.
                </p>
              </div>
              <span className="fy-chip">
                {visiblePayrollRuns.length} PAY BILL{visiblePayrollRuns.length === 1 ? "" : "S"}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pay month / department</th>
                    <th>Budget activity</th>
                    <th>Employees</th>
                    <th className="amount-cell">Gross Pay</th>
                    <th className="amount-cell">Recoveries</th>
                    <th className="amount-cell">Net Pay</th>
                    <th>Status</th>
                    <th>Voucher references</th>
                    {canUndoPayroll && <th>Control</th>}
                  </tr>
                </thead>
                <tbody>
                  {visiblePayrollRuns.map((payrollRun) => (
                    <tr key={payrollRun.id}>
                      <td>
                        <strong>{payMonthLabel(payrollRun.payMonth)}</strong>
                        <small>{payrollRun.department}</small>
                        <small>Finalized by {payrollRun.finalizedByName ?? "Payroll user"}</small>
                      </td>
                      <td>
                        <strong className="obc-code">{payrollRun.budgetActivityObc ?? "—"}</strong>
                        <small>{payrollRun.budgetActivityName ?? "Selected during posting"}</small>
                      </td>
                      <td>{payrollRun.employeeCount}</td>
                      <td className="amount-cell">{money.format(payrollRun.grossPayNu)}</td>
                      <td className="amount-cell">{money.format(payrollRun.recoveriesNu)}</td>
                      <td className="amount-cell">
                        <strong>{money.format(payrollRun.netPayNu)}</strong>
                      </td>
                      <td>
                        <span className={`status ${payrollRun.status === "Posted" ? "status-approved" : "status-pending"}`}>
                          <i />
                          {payrollRun.postingUndoneAt ? "Posting Undone" : payrollRun.status}
                        </span>
                      </td>
                      <td>
                        {payrollRun.voucherNumbers ||
                          (payrollRun.postingUndoneAt ? "Posting vouchers removed" : "Awaiting posting")}
                      </td>
                      {canUndoPayroll && (
                        <td>
                          {payrollRun.status === "Posted" ? (
                            <button
                              type="button"
                              className="payroll-undo-button"
                              onClick={() => void undoPayBill(payrollRun)}
                            >
                              Undo Pay Bill Posting
                            </button>
                          ) : payrollRun.postingUndoneAt ? (
                            <button
                              type="button"
                              className="payroll-undo-button"
                              onClick={() => void undoPayBill(payrollRun)}
                            >
                              Un-finalize Pay Bill
                            </button>
                          ) : (
                            <small>Post and undo posting first</small>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visiblePayrollRuns.length && (
                <Empty
                  message={`No pay bill has been finalized for ${selectedDepartment} in ${payMonthLabel(selectedPayMonth)}.`}
                />
              )}
            </div>
          </section>

          <section className="panel register-panel">
            <div className="register-toolbar">
              <div>
                <h3>Payroll employee register</h3>
                <p>
                  {payMonthLabel(selectedPayMonth)} · {selectedDepartment}. Inactive employees remain on record but are
                  excluded from payroll totals.
                </p>
              </div>
              <span className="fy-chip">
                {visibleEmployees.length} EMPLOYEE{visibleEmployees.length === 1 ? "" : "S"}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Employee ID</th>
                    <th>Employee</th>
                    <th>Payroll actions</th>
                    <th>CID</th>
                    <th>TPN</th>
                    <th>Email ID</th>
                    <th>Designation</th>
                    <th>Department</th>
                    <th className="amount-cell">Basic Pay</th>
                    <th className="amount-cell">Allowances</th>
                    <th className="amount-cell">Arrear</th>
                    <th className="amount-cell">Gross Pay</th>
                    <th className="amount-cell">TDS Basis (Gross − 15%)</th>
                    <th className="amount-cell">Tax on Salary (Auto)</th>
                    <th className="amount-cell">Health Contribution (1% Auto)</th>
                    <th className="amount-cell">Advance</th>
                    <th className="amount-cell">Total Deductions</th>
                    <th className="amount-cell">Net Pay</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployees.map((employee) => (
                    <tr
                      className={`${employee.employeeNumber === recentEmployeeNumber ? "new-record-row" : ""} ${
                        employee.status === "Inactive" ? "inactive-record-row" : ""
                      }`.trim()}
                      key={employee.id}
                    >
                      <td>
                        <span className="budget-id">{employee.employeeNumber}</span>
                        {employee.employeeNumber === recentEmployeeNumber && (
                          <span className="new-record-badge">Updated</span>
                        )}
                      </td>
                      <td>
                        <strong>{employee.fullName}</strong>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="payslip-link" onClick={() => setPayslipEmployee(employee)}>
                            Payslip
                          </button>
                          {canManage && (
                            <>
                              <button className="table-link edit-employee-link" onClick={() => setEmployeeModal(employee)}>
                                Edit
                              </button>
                              <button
                                className={`status-action ${
                                  employee.status === "Active" ? "deactivate-action" : "reactivate-action"
                                }`}
                                onClick={() => {
                                  const nextStatus = employee.status === "Active" ? "Inactive" : "Active";
                                  if (
                                    window.confirm(
                                      `${nextStatus === "Inactive" ? "Make" : "Restore"} ${employee.fullName} ${nextStatus.toLocaleLowerCase()}?`,
                                    )
                                  ) {
                                    void setEmployeeStatus(employee, nextStatus);
                                  }
                                }}
                              >
                                {employee.status === "Active" ? "Make inactive" : "Reactivate"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="identity-value">{employee.cid || "Not recorded"}</span>
                      </td>
                      <td>
                        <span className="identity-value">{employee.tpn || "Not recorded"}</span>
                      </td>
                      <td>
                        <a href={employee.email ? `mailto:${employee.email}` : undefined}>
                          {employee.email || "Not recorded"}
                        </a>
                      </td>
                      <td>{employee.designation}</td>
                      <td>{employee.department}</td>
                      <td className="amount-cell">{money.format(employee.basicPayNu)}</td>
                      <td className="amount-cell">{money.format(employee.allowancesNu)}</td>
                      <td className="amount-cell">{money.format(employee.arrearNu)}</td>
                      <td className="amount-cell">{money.format(employee.grossPayNu)}</td>
                      <td className="amount-cell">{money.format(employee.tdsBasisNu)}</td>
                      <td className="amount-cell">
                        <span className="auto-tax-value">
                          {money.format(employee.taxOnSalaryNu)}
                          <small>Rule 153 · Annexure I</small>
                        </span>
                      </td>
                      <td className="amount-cell">
                        <span className="auto-tax-value">
                          {money.format(employee.healthContributionNu)}
                          <small>1% Gross Pay</small>
                        </span>
                      </td>
                      <td className="amount-cell">{money.format(employee.advanceNu)}</td>
                      <td className="amount-cell">{money.format(employee.deductionsNu)}</td>
                      <td className="amount-cell">
                        <strong>{money.format(employee.grossPayNu - employee.deductionsNu)}</strong>
                      </td>
                      <td>
                        <span className={`status ${employee.status === "Active" ? "status-approved" : "status-rejected"}`}>
                          <i />
                          {employee.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleEmployees.length && (
                <Empty message={`No employees are registered under ${selectedDepartment}.`} />
              )}
            </div>
          </section>
        </>
      )}

      {modal === "department" && (
        <DepartmentManagementModal departments={departments} onClose={() => setModal(null)} />
      )}
      {modal === "payBill" && (
        <PayBillModal
          employees={employees}
          payrollRuns={payrollRuns}
          payrollRunItems={payrollRunItems}
          onClose={() => setModal(null)}
          onUndo={undoPayBill}
        />
      )}
      {modal === "posting" && (
        <PayBillPostingModal
          payrollRuns={payrollRuns}
          activities={activities}
          onClose={() => setModal(null)}
          onPosted={() => setModal(null)}
          onUndo={undoPayBill}
        />
      )}
      {modal === "tdsSchedule" && (
        <TdsScheduleModal
          payrollRuns={payrollRuns}
          payrollRunItems={payrollRunItems}
          remittanceRuns={payrollRemittanceRuns}
          onClose={() => setModal(null)}
          onPosted={() => setModal(null)}
        />
      )}
      {employeeModal && (
        <EmployeeModal
          employee={employeeModal === "new" ? undefined : employeeModal}
          departments={departments}
          onClose={() => setEmployeeModal(null)}
          onCompleted={(employee, created) => {
            setRecentEmployeeNumber(employee.employeeNumber);
            if (created) setPayslipEmployee(employee);
          }}
        />
      )}
      {payslipEmployee && (
        <PayslipModal
          employee={payslipEmployee}
          payMonthLabel={payMonthLabel(selectedPayMonth || currentBhutanMonth())}
          onClose={() => setPayslipEmployee(null)}
        />
      )}
    </>
  );
}
