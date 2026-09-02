import { and, eq, ne, or, sql as raw } from "drizzle-orm";
import { db } from "../../db/client.js";
import { departments, employees, payrollRunItems, payrollRuns } from "../../db/schema.js";
import { calculateEmployeePayroll } from "../../domain/payroll-tax.js";
import { roundNu } from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { PG_UNIQUE_VIOLATION, badRequest, conflict, isPostgresError, notFound } from "../../lib/errors.js";
import type { SessionUser } from "../auth/auth.service.js";

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */

export async function addDepartment(user: SessionUser, name: string): Promise<void> {
  const departmentName = name.trim().replace(/\s+/g, " ").normalize("NFC");

  try {
    const [created] = await db
      .insert(departments)
      .values({ name: departmentName, createdBy: user.id })
      .returning({ id: departments.id });
    await audit(user.id, "department_added", "department", created.id, departmentName);
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION)) throw conflict("That department already exists.");
    throw error;
  }
}

/**
 * Renames a department and carries the new name through every employee and
 * payroll record that referenced it, so historic pay bills keep resolving.
 */
export async function updateDepartment(user: SessionUser, departmentId: number, name: string): Promise<void> {
  const departmentName = name.trim().replace(/\s+/g, " ").normalize("NFC");

  await db.transaction(async (tx) => {
    const [department] = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.id, departmentId))
      .for("update")
      .limit(1);

    if (!department) throw notFound("The selected department was not found.");
    if (department.name === departmentName) throw badRequest("Enter a different department name before saving.");

    const [duplicate] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(ne(departments.id, departmentId), raw`lower(${departments.name}) = lower(${departmentName})`))
      .limit(1);
    if (duplicate) throw conflict("That department already exists.");

    await tx.update(departments).set({ name: departmentName }).where(eq(departments.id, departmentId));
    await tx.update(employees).set({ department: departmentName }).where(eq(employees.department, department.name));
    await tx.update(payrollRuns).set({ department: departmentName }).where(eq(payrollRuns.department, department.name));
    await tx
      .update(payrollRunItems)
      .set({ department: departmentName })
      .where(eq(payrollRunItems.department, department.name));

    await audit(
      user.id,
      "department_updated",
      "department",
      departmentId,
      `${department.name} renamed to ${departmentName}; employee and payroll department references updated`,
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Employees                                                                  */
/* -------------------------------------------------------------------------- */

export type EmployeeInput = {
  employeeNumber: string;
  cid: string;
  tpn: string;
  email: string;
  fullName: string;
  designation: string;
  department: string;
  accountNumber?: string;
  bankName?: string;
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  advanceNu: number;
};

function normalizeEmployee(input: EmployeeInput) {
  return {
    employeeNumber: input.employeeNumber.trim().toLocaleUpperCase(),
    cid: input.cid.trim(),
    tpn: input.tpn.trim().toLocaleUpperCase(),
    email: input.email.trim().toLocaleLowerCase().normalize("NFC"),
    fullName: input.fullName.trim(),
    designation: input.designation.trim(),
    department: input.department.trim(),
    accountNumber: input.accountNumber?.trim() || null,
    bankName: input.bankName?.trim() || null,
    basicPayNu: roundNu(input.basicPayNu),
    allowancesNu: roundNu(input.allowancesNu),
    arrearNu: roundNu(input.arrearNu),
    advanceNu: roundNu(input.advanceNu),
  };
}

/** Departments are admin-managed; free-text department names are rejected. */
async function resolveDepartmentName(requested: string): Promise<string> {
  const [department] = await db
    .select({ name: departments.name })
    .from(departments)
    .where(raw`lower(${departments.name}) = lower(${requested})`)
    .limit(1);
  if (!department) throw conflict("Select a department from the Admin-managed department list.");
  return department.name;
}

function describeDuplicate(
  duplicate: { employeeNumber: string; cid: string | null; tpn: string | null; email: string | null },
  values: { employeeNumber: string; cid: string; tpn: string; email: string },
): string {
  if (duplicate.employeeNumber === values.employeeNumber) return "employee number";
  if (duplicate.cid === values.cid) return "CID";
  if (duplicate.tpn === values.tpn) return "TPN";
  return "email ID";
}

export async function addEmployee(user: SessionUser, input: EmployeeInput): Promise<void> {
  const values = normalizeEmployee(input);
  const payroll = calculateEmployeePayroll(values);
  if (payroll.deductionsNu >= payroll.grossPayNu) {
    throw badRequest("Total deductions must be less than gross pay.");
  }

  const department = await resolveDepartmentName(values.department);

  const [duplicate] = await db
    .select({
      employeeNumber: employees.employeeNumber,
      cid: employees.cid,
      tpn: employees.tpn,
      email: employees.email,
    })
    .from(employees)
    .where(
      or(
        eq(employees.employeeNumber, values.employeeNumber),
        eq(employees.cid, values.cid),
        eq(employees.tpn, values.tpn),
        eq(employees.email, values.email),
      ),
    )
    .limit(1);
  if (duplicate) throw conflict(`That ${describeDuplicate(duplicate, values)} is already registered.`);

  try {
    const [created] = await db
      .insert(employees)
      .values({
        ...values,
        department,
        grossPayNu: payroll.grossPayNu,
        taxOnSalaryNu: payroll.taxOnSalaryNu,
        healthContributionNu: payroll.healthContributionNu,
        deductionsNu: payroll.deductionsNu,
        status: "Active",
        createdBy: user.id,
      })
      .returning({ id: employees.id });

    await audit(user.id, "employee_added", "employee", created.id, `${values.employeeNumber} - ${values.fullName}`);
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION)) {
      throw conflict("That employee number, CID, TPN or email ID is already registered.");
    }
    throw error;
  }
}

export async function updateEmployee(user: SessionUser, employeeId: number, input: EmployeeInput): Promise<void> {
  const values = normalizeEmployee(input);
  const payroll = calculateEmployeePayroll(values);
  if (payroll.deductionsNu >= payroll.grossPayNu) {
    throw badRequest("Total deductions must be less than gross pay.");
  }

  const department = await resolveDepartmentName(values.department);

  const [existing] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!existing) throw notFound("The employee record was not found.");

  const [duplicate] = await db
    .select({
      employeeNumber: employees.employeeNumber,
      cid: employees.cid,
      tpn: employees.tpn,
      email: employees.email,
    })
    .from(employees)
    .where(
      and(
        ne(employees.id, employeeId),
        or(
          eq(employees.employeeNumber, values.employeeNumber),
          eq(employees.cid, values.cid),
          eq(employees.tpn, values.tpn),
          eq(employees.email, values.email),
        ),
      ),
    )
    .limit(1);
  if (duplicate) throw conflict(`That ${describeDuplicate(duplicate, values)} is already registered.`);

  try {
    await db
      .update(employees)
      .set({
        ...values,
        department,
        grossPayNu: payroll.grossPayNu,
        taxOnSalaryNu: payroll.taxOnSalaryNu,
        healthContributionNu: payroll.healthContributionNu,
        deductionsNu: payroll.deductionsNu,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employeeId));

    await audit(user.id, "employee_updated", "employee", employeeId, `${values.employeeNumber} - ${values.fullName}`);
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION)) {
      throw conflict("That employee number, CID, TPN or email ID is already registered.");
    }
    throw error;
  }
}

export async function setEmployeeStatus(
  user: SessionUser,
  employeeId: number,
  status: "Active" | "Inactive",
): Promise<void> {
  const [employee] = await db
    .select({ employeeNumber: employees.employeeNumber, fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!employee) throw notFound("The employee record was not found.");

  await db.update(employees).set({ status, updatedAt: new Date() }).where(eq(employees.id, employeeId));
  await audit(
    user.id,
    `employee_${status.toLocaleLowerCase()}`,
    "employee",
    employeeId,
    `${employee.employeeNumber} - ${employee.fullName}`,
  );
}

export async function updateEmployeeIdentity(
  user: SessionUser,
  employeeId: number,
  identity: { cid: string; tpn: string },
): Promise<void> {
  const cid = identity.cid.trim();
  const tpn = identity.tpn.trim().toLocaleUpperCase();

  const [employee] = await db
    .select({ employeeNumber: employees.employeeNumber, fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!employee) throw notFound("The employee record was not found.");

  const [duplicate] = await db
    .select({ cid: employees.cid, tpn: employees.tpn })
    .from(employees)
    .where(and(ne(employees.id, employeeId), or(eq(employees.cid, cid), eq(employees.tpn, tpn))))
    .limit(1);
  if (duplicate) throw conflict(`That ${duplicate.cid === cid ? "CID" : "TPN"} is already registered.`);

  await db.update(employees).set({ cid, tpn, updatedAt: new Date() }).where(eq(employees.id, employeeId));
  await audit(
    user.id,
    "employee_identity_updated",
    "employee",
    employeeId,
    `${employee.employeeNumber} - ${employee.fullName}`,
  );
}