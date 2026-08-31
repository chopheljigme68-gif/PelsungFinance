"use client";

import { useState, type FormEvent } from "react";
import { ModalShell, PelsungLogo } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { money, ngultrumInWords } from "@/lib/format";
import { calculateBhutanMonthlyPayrollTax, calculateHealthContribution } from "@/lib/payroll-tax";
import { useApp } from "@/providers/app-provider";
import type { Department, Employee } from "@/types";

/* -------------------------------------------------------------------------- */
/* Department management                                                      */
/* -------------------------------------------------------------------------- */

export function DepartmentManagementModal({
  departments,
  onClose,
}: {
  departments: Department[];
  onClose: () => void;
}) {
  const { fiscalYear, run } = useApp();
  const [departmentName, setDepartmentName] = useState("");
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState("");
  const [savingAction, setSavingAction] = useState<"add" | "edit" | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSavingAction("add");
    const normalizedName = departmentName.trim().replace(/\s+/g, " ");
    const saved = await run(
      () => api.addDepartment({ fiscalYear, departmentName: normalizedName }),
      `${normalizedName} was added to the department list.`,
    );
    setSavingAction(null);
    if (saved) setDepartmentName("");
  };

  const cancelEdit = () => {
    setEditingDepartmentId(null);
    setEditingDepartmentName("");
  };

  const saveEdit = async (event: FormEvent, department: Department) => {
    event.preventDefault();
    const normalizedName = editingDepartmentName.trim().replace(/\s+/g, " ");
    if (normalizedName === department.name) return cancelEdit();
    setSavingAction("edit");
    const saved = await run(
      () => api.updateDepartment(department.id, { fiscalYear, departmentName: normalizedName }),
      `${department.name} was renamed to ${normalizedName}. Employee and payroll department references were updated.`,
    );
    setSavingAction(null);
    if (saved) cancelEdit();
  };

  return (
    <ModalShell onClose={onClose}>
      <article className="modal-card department-management-card" role="dialog" aria-modal="true" aria-label="Department Management">
        <header>
          <div>
            <span className="eyebrow dark">Admin · Payroll setup</span>
            <h2>Department Management</h2>
            <p>Add or edit departments in the shared employee and payroll dropdown list.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="department-management-body">
          <form className="department-add-form" onSubmit={submit}>
            <label>
              Department name
              <input
                minLength={2}
                maxLength={120}
                value={departmentName}
                onChange={(event) => setDepartmentName(event.target.value)}
                placeholder="e.g. Finance and Accounts"
                required
              />
            </label>
            <button className="primary-button" disabled={savingAction !== null}>
              {savingAction === "add" ? "Adding…" : "Add department"}
            </button>
          </form>

          <section>
            <div className="department-register-heading">
              <div>
                <h3>Available departments</h3>
                <p>Use Edit to correct a department name throughout employee and payroll records.</p>
              </div>
              <span>
                {departments.length} DEPARTMENT{departments.length === 1 ? "" : "S"}
              </span>
            </div>
            <div className="department-list">
              {departments.map((department) => (
                <div key={department.id}>
                  <span className="department-list-icon">{department.name.slice(0, 2).toLocaleUpperCase()}</span>
                  {editingDepartmentId === department.id ? (
                    <form className="department-edit-form" onSubmit={(event) => void saveEdit(event, department)}>
                      <label>
                        <span>Edit department name</span>
                        <input
                          autoFocus
                          minLength={2}
                          maxLength={120}
                          value={editingDepartmentName}
                          onChange={(event) => setEditingDepartmentName(event.target.value)}
                          required
                        />
                      </label>
                      <div className="department-edit-actions">
                        <button type="button" onClick={cancelEdit} disabled={savingAction !== null}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={
                            savingAction !== null ||
                            editingDepartmentName.trim().replace(/\s+/g, " ") === department.name
                          }
                        >
                          {savingAction === "edit" ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="department-list-details">
                        <strong>{department.name}</strong>
                        <small>
                          {department.employeeCount} employee{department.employeeCount === 1 ? "" : "s"}
                          {department.createdByName
                            ? ` · Added by ${department.createdByName}`
                            : " · Existing employee department"}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="department-edit-button"
                        onClick={() => {
                          setEditingDepartmentId(department.id);
                          setEditingDepartmentName(department.name);
                        }}
                        disabled={savingAction !== null}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!departments.length && (
                <div className="empty-state">
                  <span>✓</span>
                  <strong>No departments have been added yet.</strong>
                  <small>Add the first department to start registering employees.</small>
                </div>
              )}
            </div>
          </section>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </footer>
      </article>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Employee record                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Add or edit an employee. Salary tax and health contribution are computed, not
 * entered — the preview uses the same rule the server applies on save.
 */
export function EmployeeModal({
  employee,
  departments,
  onClose,
  onCompleted,
}: {
  employee?: Employee;
  departments: Department[];
  onClose: () => void;
  onCompleted: (employee: Employee, created: boolean) => void;
}) {
  const { fiscalYear, run } = useApp();
  const created = !employee;

  const [employeeNumber, setEmployeeNumber] = useState(employee?.employeeNumber ?? "");
  const [cid, setCid] = useState(employee?.cid ?? "");
  const [tpn, setTpn] = useState(employee?.tpn ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [fullName, setFullName] = useState(employee?.fullName ?? "");
  const [designation, setDesignation] = useState(employee?.designation ?? "");
  const [department, setDepartment] = useState(employee?.department ?? departments[0]?.name ?? "");
  const [basicPayNu, setBasicPayNu] = useState(String(employee?.basicPayNu ?? ""));
  const [allowancesNu, setAllowancesNu] = useState(String(employee?.allowancesNu ?? 0));
  const [arrearNu, setArrearNu] = useState(String(employee?.arrearNu ?? 0));
  const [advanceNu, setAdvanceNu] = useState(String(employee?.advanceNu ?? 0));
  const [saving, setSaving] = useState(false);

  const grossPayNu = Number(basicPayNu || 0) + Number(allowancesNu || 0) + Number(arrearNu || 0);
  const tax = calculateBhutanMonthlyPayrollTax(grossPayNu);
  const healthContributionNu = calculateHealthContribution(grossPayNu);
  const deductionsNu = tax.taxOnSalaryNu + healthContributionNu + Number(advanceNu || 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const normalizedEmployeeNumber = employeeNumber.trim().toLocaleUpperCase();
    const payload = {
      fiscalYear,
      employeeNumber,
      cid,
      tpn,
      email,
      fullName,
      designation,
      department,
      basicPayNu: Number(basicPayNu),
      allowancesNu: Number(allowancesNu),
      arrearNu: Number(arrearNu),
      advanceNu: Number(advanceNu),
    };

    const saved = await run(
      () => (created ? api.addEmployee(payload) : api.updateEmployee(employee.id, payload)),
      created
        ? `${fullName} was added. The employee is now first in the register and the payslip is ready.`
        : `${fullName}'s employee and payroll details were updated.`,
      {
        onSuccess: (snapshot) => {
          const savedEmployee = snapshot.employees.find((item) =>
            created ? item.employeeNumber === normalizedEmployeeNumber : item.id === employee?.id,
          );
          if (savedEmployee) onCompleted(savedEmployee, created);
        },
      },
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <form className="modal-card" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Payroll</span>
            <h2>{created ? "Add employee" : "Edit employee"}</h2>
            <p>
              {created
                ? "Create an active employee master record with identity, email, tax and payroll details."
                : "Update employee identity, email, work details, earnings and deductions."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="form-grid">
          <div className="form-section-label wide">Employee identity</div>
          <label>
            Employee number
            <input
              maxLength={30}
              value={employeeNumber}
              onChange={(event) => setEmployeeNumber(event.target.value)}
              placeholder="P-006"
              required
            />
          </label>
          <label>
            CID
            <input
              inputMode="numeric"
              pattern="[0-9]{11}"
              maxLength={11}
              value={cid}
              onChange={(event) => setCid(event.target.value.replace(/\D/g, ""))}
              placeholder="11-digit CID"
              required
            />
          </label>
          <label>
            TPN
            <input
              maxLength={30}
              pattern="[A-Za-z0-9./-]+"
              value={tpn}
              onChange={(event) => setTpn(event.target.value.toLocaleUpperCase())}
              placeholder="Taxpayer number"
              required
            />
          </label>
          <label>
            Email ID
            <input
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="employee@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Full name
            <input maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} required />
          </label>
          <label>
            Designation
            <input
              maxLength={120}
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              required
            />
          </label>
          <label>
            Department
            <select
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              required
              disabled={!departments.length}
            >
              {departments.length ? (
                departments.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))
              ) : (
                <option value="">Admin must add a department first</option>
              )}
            </select>
          </label>

          <div className="form-section-label wide">Earnings</div>
          <label>
            Basic Pay (Nu.)
            <input
              type="number"
              min="1"
              step="1"
              value={basicPayNu}
              onChange={(event) => setBasicPayNu(event.target.value)}
              required
            />
          </label>
          <label>
            Allowances (Nu.)
            <input
              type="number"
              min="0"
              step="1"
              value={allowancesNu}
              onChange={(event) => setAllowancesNu(event.target.value)}
              required
            />
          </label>
          <label>
            Arrear (Nu.)
            <input
              type="number"
              min="0"
              step="1"
              value={arrearNu}
              onChange={(event) => setArrearNu(event.target.value)}
              required
            />
          </label>

          <div className="form-section-label wide">Deductions</div>
          <div className="automatic-tax-field">
            <span>Tax on Salary</span>
            <strong>{money.format(tax.taxOnSalaryNu)}</strong>
          </div>
          <div className="automatic-tax-field">
            <span>Health Contribution</span>
            <strong>{money.format(healthContributionNu)}</strong>
          </div>
          <label>
            Advance (Nu.)
            <input
              type="number"
              min="0"
              step="1"
              value={advanceNu}
              onChange={(event) => setAdvanceNu(event.target.value)}
              required
            />
          </label>
          <div className="budget-check wide">
            <span>
              <b>Gross Pay</b> {money.format(grossPayNu)}
            </span>
            <span>
              <b>Total Deductions</b> {money.format(deductionsNu)}
            </span>
            <strong>Net Pay {money.format(grossPayNu - deductionsNu)}</strong>
          </div>
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || !departments.length}>
            {saving ? "Saving…" : created ? "Add employee" : "Save changes"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Payslip                                                                    */
/* -------------------------------------------------------------------------- */

export function PayslipModal({
  employee,
  payMonthLabel: monthLabel,
  onClose,
}: {
  employee: Employee;
  payMonthLabel: string;
  onClose: () => void;
}) {
  const netPayNu = employee.grossPayNu - employee.deductionsNu;

  return (
    <ModalShell className="payslip-backdrop" onClose={onClose}>
      <article className="payslip-card" role="dialog" aria-modal="true" aria-label={`Payslip for ${employee.fullName}`}>
        <div className="epems-payslip-document">
          <header className="epems-payslip-masthead">
            <div className="epems-payslip-logo">
              <PelsungLogo />
            </div>
            <div>
              <span>Pelsung Accounting Management System</span>
              <h2>PELSUNG</h2>
              <strong>Department : {employee.department.toLocaleUpperCase()}</strong>
            </div>
            <div aria-hidden="true" />
          </header>

          <h3 className="epems-payslip-title">Pay Slip for the month of {monthLabel}</h3>

          <section className="epems-payslip-identity" aria-label="Employee identity">
            <dl>
              <div>
                <dt>Employee ID</dt>
                <dd>: {employee.employeeNumber}</dd>
              </div>
              <div>
                <dt>Citizen ID / CID No.</dt>
                <dd>: {employee.cid || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>: {employee.fullName}</dd>
              </div>
              <div>
                <dt>Designation</dt>
                <dd>: {employee.designation}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>: {employee.department}</dd>
              </div>
              <div>
                <dt>TPN No.</dt>
                <dd>: {employee.tpn || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Email ID</dt>
                <dd>: {employee.email || "Not recorded"}</dd>
              </div>
            </dl>
          </section>

          <section className="epems-pay-basics" aria-label="Payroll particulars">
            <dl>
              <div>
                <dt>Basic Pay</dt>
                <dd>: {money.format(employee.basicPayNu)}</dd>
              </div>
              <div>
                <dt>Arrears</dt>
                <dd>: {money.format(employee.arrearNu)}</dd>
              </div>
              <div>
                <dt>Allowances</dt>
                <dd>: {money.format(employee.allowancesNu)}</dd>
              </div>
            </dl>
            <dl>
              <div>
                <dt>TPN No.</dt>
                <dd>: {employee.tpn || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Payroll Status</dt>
                <dd>: {employee.status}</dd>
              </div>
              <div>
                <dt>Pay Slip Reference</dt>
                <dd>
                  : PS-{monthLabel.slice(0, 3).toLocaleUpperCase()}-{monthLabel.slice(-4)}-{employee.employeeNumber}
                </dd>
              </div>
            </dl>
          </section>

          <section className="epems-payslip-tables">
            <div>
              <h4>Earnings</h4>
              <table>
                <thead>
                  <tr>
                    <th>SLNo</th>
                    <th>Earning</th>
                    <th>Amount (Nu.)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>Basic Pay</td>
                    <td>{money.format(employee.basicPayNu)}</td>
                  </tr>
                  <tr>
                    <td>2</td>
                    <td>Allowances</td>
                    <td>{money.format(employee.allowancesNu)}</td>
                  </tr>
                  <tr>
                    <td>3</td>
                    <td>Arrear</td>
                    <td>{money.format(employee.arrearNu)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Total Earnings</th>
                    <th>{money.format(employee.grossPayNu)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div>
              <h4>Statutory Deductions</h4>
              <table>
                <thead>
                  <tr>
                    <th>SLNo</th>
                    <th>Deduction</th>
                    <th>Amount (Nu.)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>Tax Deducted at Source</td>
                    <td>{money.format(employee.taxOnSalaryNu)}</td>
                  </tr>
                  <tr>
                    <td>2</td>
                    <td>Provident Fund (Nil)</td>
                    <td>{money.format(0)}</td>
                  </tr>
                  <tr>
                    <td>3</td>
                    <td>Health Contribution (1% of Gross Pay)</td>
                    <td>{money.format(employee.healthContributionNu)}</td>
                  </tr>
                </tbody>
              </table>
              <h4 className="epems-other-deductions">Other Deductions</h4>
              <table>
                <thead>
                  <tr>
                    <th>SLNo</th>
                    <th>Deduction</th>
                    <th>Amount (Nu.)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>Advance</td>
                    <td>{money.format(employee.advanceNu)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Total Deductions</th>
                    <th>{money.format(employee.deductionsNu)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="epems-pay-summary">
            <p>
              <span>Gross Pay</span>
              <strong>: {money.format(employee.grossPayNu)}</strong>
              <small>( Basic Pay + Arrears + Allowances )</small>
            </p>
            <p>
              <span>Net Payment</span>
              <strong>: {money.format(netPayNu)}</strong>
              <small>( {ngultrumInWords(netPayNu)} )</small>
            </p>
          </section>

          <footer className="payslip-signatures">
            <div>
              <i />
              <span>Head of Finance</span>
            </div>
          </footer>
          <p className="epems-payslip-generated">Generated from Pelsung Accounting Management System</p>
        </div>
        <div className="payslip-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button" onClick={() => window.print()}>
            Print payslip
          </button>
        </div>
      </article>
    </ModalShell>
  );
}
