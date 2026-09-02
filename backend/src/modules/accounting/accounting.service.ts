import { sql as raw } from "drizzle-orm";
import { db, type DbExecutor } from "../../db/client.js";
import { BASE_FISCAL_YEARS } from "../../domain/fiscal-year.js";
import { BHUTAN_PAYROLL_TAX_RULE, calculateBhutanMonthlyPayrollTax, calculateHealthContribution } from "../../domain/payroll-tax.js";
import { roleLabels, type AppRole } from "../../domain/permissions.js";
import { can, publicUser, type SessionUser } from "../auth/auth.service.js";
import type {
  AccountingData,
  Activity,
  BudgetReappropriation,
  Department,
  Employee,
  ManagedUser,
  PayrollRemittanceRun,
  PayrollRun,
  PayrollRunItem,
  SupplementaryBudget,
  SupplierTdsRemittanceRun,
  Voucher,
  VoucherBudgetLine,
} from "./accounting.types.js";

/**
 * The application reads its whole working set for one fiscal year in a single
 * request, exactly as the previous build did: every screen (dashboard, ledger,
 * reports, approvals) derives from the same consistent snapshot, so partial
 * per-screen fetches would let the numbers disagree between panels.
 *
 * Each statement below is a hand-written SQL projection rather than an ORM
 * query because they aggregate committed/utilized budget in the same pass —
 * this is the one place raw SQL earns its keep.
 */
export async function loadAccountingData(
  user: SessionUser,
  fiscalYear: string,
  executor: DbExecutor = db,
): Promise<AccountingData> {
  const canViewPayroll = can(user, "view_payroll");
  const canManageUsers = can(user, "manage_users");

  const [
    activities,
    voucherRows,
    budgetLineRows,
    storedFiscalYears,
    employeeRows,
    departments,
    payrollRuns,
    payrollRunItems,
    payrollRemittanceRuns,
    supplierTdsRemittanceRuns,
    users,
    budgetReappropriations,
    supplementaryBudgets,
  ] = await Promise.all([
    selectActivities(executor, fiscalYear),
    selectVouchers(executor, fiscalYear),
    selectVoucherBudgetLines(executor, fiscalYear),
    selectStoredFiscalYears(executor),
    canViewPayroll ? selectEmployees(executor) : Promise.resolve([]),
    canViewPayroll ? selectDepartments(executor) : Promise.resolve([]),
    canViewPayroll ? selectPayrollRuns(executor, fiscalYear) : Promise.resolve([]),
    canViewPayroll ? selectPayrollRunItems(executor, fiscalYear) : Promise.resolve([]),
    canViewPayroll ? selectPayrollRemittanceRuns(executor, fiscalYear) : Promise.resolve([]),
    selectSupplierTdsRemittanceRuns(executor, fiscalYear),
    canManageUsers ? selectUsers(executor) : Promise.resolve([]),
    selectBudgetReappropriations(executor, fiscalYear),
    selectSupplementaryBudgets(executor, fiscalYear),
  ]);

  const fiscalYears = [...new Set([...BASE_FISCAL_YEARS, fiscalYear, ...storedFiscalYears])].sort((a, b) =>
    b.localeCompare(a),
  );

  const budgetLinesByVoucher = new Map<number, VoucherBudgetLine[]>();
  for (const line of budgetLineRows) {
    const lines = budgetLinesByVoucher.get(line.voucherId);
    if (lines) lines.push(line);
    else budgetLinesByVoucher.set(line.voucherId, [line]);
  }

  const vouchers: Voucher[] = voucherRows.map((voucher) => ({
    ...voucher,
    budgetLines: budgetLinesByVoucher.get(voucher.id) ?? [],
  }));

  // Tax figures are always recomputed from gross pay so a change in the rules
  // takes effect immediately, rather than serving figures stored months ago.
  const employees: Employee[] = employeeRows.map((employee) => {
    const tax = calculateBhutanMonthlyPayrollTax(employee.grossPayNu);
    const healthContributionNu = calculateHealthContribution(employee.grossPayNu);
    return {
      ...employee,
      ...tax,
      healthContributionNu,
      deductionsNu: tax.taxOnSalaryNu + healthContributionNu + employee.advanceNu,
    };
  });

  return {
    activities,
    vouchers,
    employees,
    departments,
    payrollRuns,
    payrollRunItems,
    payrollRemittanceRuns,
    supplierTdsRemittanceRuns,
    budgetReappropriations,
    supplementaryBudgets,
    users,
    currentUser: publicUser(user),
    fiscalYear,
    fiscalYears,
    payrollTaxRule: BHUTAN_PAYROLL_TAX_RULE,
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                */
/* -------------------------------------------------------------------------- */

async function selectActivities(executor: DbExecutor, fiscalYear: string): Promise<Activity[]> {
  const rows = await executor.execute<Activity>(raw`
    SELECT
      a.id,
      a.fiscal_year        AS "fiscalYear",
      a.category,
      a.financing,
      a.obc,
      a.activity,
      a.budget_type        AS "budgetType",
      a.approved_nu        AS "approvedNu",
      a.brief,
      COALESCE(SUM(CASE WHEN v.voucher_type <> 'Advance' AND v.status = 'Paid' THEN line.amount_nu ELSE 0 END), 0) AS "utilizedNu",
      COALESCE(SUM(CASE WHEN v.voucher_type <> 'Advance' AND v.status IN ('Approved','Paid') THEN line.amount_nu ELSE 0 END), 0) AS "committedNu"
    FROM budget_activities a
    LEFT JOIN voucher_budget_lines line ON line.activity_id = a.id
    LEFT JOIN vouchers v ON v.id = line.voucher_id
    WHERE a.fiscal_year = ${fiscalYear}
    GROUP BY a.id
    ORDER BY a.id
  `);
  return rows as unknown as Activity[];
}

type VoucherRow = Omit<Voucher, "budgetLines">;

async function selectVouchers(executor: DbExecutor, fiscalYear: string): Promise<VoucherRow[]> {
  const rows = await executor.execute<VoucherRow>(raw`
    SELECT
      v.id,
      v.voucher_number     AS "voucherNumber",
      v.activity_id        AS "activityId",
      v.fiscal_year        AS "fiscalYear",
      v.voucher_type       AS "voucherType",
      v.payee,
      v.tpn,
      v.payee_account_number AS "payeeAccountNumber",
      v.payee_bank_name      AS "payeeBankName",
      v.bill_reference     AS "billReference",
      v.description,
      v.amount_nu          AS "amountNu",
      COALESCE(v.gst_nu, 0)               AS "gstNu",
      COALESCE(v.tds_rate, 0)             AS "tdsRate",
      COALESCE(v.tds_nu, 0)               AS "tdsNu",
      COALESCE(v.advance_recovery_nu, 0)  AS "advanceRecoveryNu",
      v.advance_recovery_voucher_id       AS "advanceRecoveryVoucherId",
      CASE
        WHEN v.payroll_entry_type = 'combined' THEN v.net_payment_nu
        ELSE COALESCE(NULLIF(v.net_payment_nu, 0), v.amount_nu - COALESCE(v.tds_nu, 0) - COALESCE(v.advance_recovery_nu, 0))
      END AS "netPaymentNu",
      v.payroll_run_id                    AS "payrollRunId",
      v.payroll_remittance_run_id         AS "payrollRemittanceRunId",
      v.supplier_tds_remittance_run_id    AS "supplierTdsRemittanceRunId",
      v.payroll_entry_type                AS "payrollEntryType",
      COALESCE(v.payroll_health_contribution_nu, 0) AS "payrollHealthContributionNu",
      COALESCE(supplier_run.tds_rate, 0)  AS "supplierTdsRate",
      EXISTS (
        SELECT 1 FROM supplier_tds_remittance_items item
        JOIN supplier_tds_remittance_runs remittance ON remittance.id = item.remittance_run_id
        WHERE item.voucher_id = v.id AND remittance.status <> 'Reversed'
      ) AS "supplierTdsRemitted",
      (
        SELECT remittance_voucher.voucher_number
        FROM supplier_tds_remittance_items item
        JOIN supplier_tds_remittance_runs remittance
          ON remittance.id = item.remittance_run_id AND remittance.status <> 'Reversed'
        JOIN vouchers remittance_voucher ON remittance_voucher.supplier_tds_remittance_run_id = remittance.id
        WHERE item.voucher_id = v.id
        ORDER BY remittance.id DESC
        LIMIT 1
      ) AS "supplierTdsRemittanceVoucherNumber",
      (
        SELECT string_agg(source_voucher.voucher_number, ', ' ORDER BY source_voucher.voucher_number)
        FROM supplier_tds_remittance_items source_item
        JOIN vouchers source_voucher ON source_voucher.id = source_item.voucher_id
        WHERE source_item.remittance_run_id = v.supplier_tds_remittance_run_id
      ) AS "supplierTdsSourceVoucherNumbers",
      recovered_advance.voucher_number AS "advanceRecoveryVoucherNumber",
      v.status,
      v.transaction_date   AS "transactionDate",
      v.created_at         AS "createdAt",
      v.created_by         AS "createdBy",
      v.approved_by        AS "approvedBy",
      v.approved_at        AS "approvedAt",
      v.reversed_by        AS "reversedBy",
      v.reversed_at        AS "reversedAt",
      v.reversal_reason    AS "reversalReason",
      COALESCE(a.activity, CASE v.payroll_entry_type
        WHEN 'gross'                  THEN 'Gross Payroll Expense'
        WHEN 'recoveries'             THEN 'Payroll Recoveries Control'
        WHEN 'net'                    THEN 'Net Salary Payment'
        WHEN 'combined'               THEN 'Payroll Payment'
        WHEN 'tds_hc_remittance'      THEN 'Salary TDS & Health Contribution Remittance'
        WHEN 'supplier_tds_remittance' THEN 'TDS Remittance'
        ELSE CASE WHEN v.voucher_type = 'Receipt' THEN 'Fund Received from ' || v.payee ELSE 'Advance (non-budget)' END
      END) AS "activity",
      COALESCE(a.obc, CASE v.payroll_entry_type
        WHEN 'gross'                  THEN 'PAY-GROSS'
        WHEN 'recoveries'             THEN 'PAY-REC'
        WHEN 'net'                    THEN 'PAY-NET'
        WHEN 'combined'               THEN 'PAY-COMB'
        WHEN 'tds_hc_remittance'      THEN 'PAY-REMIT'
        WHEN 'supplier_tds_remittance' THEN 'TDS-REMIT'
        ELSE CASE WHEN v.voucher_type = 'Receipt' THEN 'FUND-REC' ELSE 'ADV' END
      END) AS "obc",
      COALESCE(a.category, CASE
        WHEN v.payroll_entry_type = 'supplier_tds_remittance' THEN 'Tax Control'
        WHEN v.payroll_entry_type IS NOT NULL THEN 'Payroll Control'
        WHEN v.voucher_type = 'Receipt' THEN 'Fund Receipt'
        ELSE 'Advance Receivable'
      END) AS "category",
      creator.display_name AS "createdByName",
      creator.cid          AS "createdByCid",
      creator.designation  AS "createdByDesignation",
      approver.display_name AS "approvedByName",
      approver.cid          AS "approvedByCid",
      approver.designation  AS "approvedByDesignation",
      reverser.display_name AS "reversedByName"
    FROM vouchers v
    LEFT JOIN budget_activities a ON a.id = v.activity_id
    LEFT JOIN vouchers recovered_advance ON recovered_advance.id = v.advance_recovery_voucher_id
    LEFT JOIN supplier_tds_remittance_runs supplier_run ON supplier_run.id = v.supplier_tds_remittance_run_id
    LEFT JOIN users creator ON creator.id = v.created_by
    LEFT JOIN users approver ON approver.id = v.approved_by
    LEFT JOIN users reverser ON reverser.id = v.reversed_by
    WHERE v.fiscal_year = ${fiscalYear}
    ORDER BY v.id DESC
  `);
  return rows as unknown as VoucherRow[];
}

async function selectVoucherBudgetLines(executor: DbExecutor, fiscalYear: string): Promise<VoucherBudgetLine[]> {
  const rows = await executor.execute<VoucherBudgetLine>(raw`
    SELECT
      line.id,
      line.voucher_id   AS "voucherId",
      line.activity_id  AS "activityId",
      line.amount_nu    AS "amountNu",
      activity.obc,
      activity.activity,
      activity.category,
      activity.financing,
      activity.budget_type  AS "budgetType",
      activity.approved_nu  AS "approvedNu"
    FROM voucher_budget_lines line
    JOIN vouchers voucher ON voucher.id = line.voucher_id
    JOIN budget_activities activity ON activity.id = line.activity_id
    WHERE voucher.fiscal_year = ${fiscalYear}
    ORDER BY line.voucher_id DESC, line.id
  `);
  return rows as unknown as VoucherBudgetLine[];
}

async function selectStoredFiscalYears(executor: DbExecutor): Promise<string[]> {
  const rows = await executor.execute<{ fiscalYear: string }>(raw`
    SELECT DISTINCT fiscal_year AS "fiscalYear"
    FROM budget_activities
    WHERE fiscal_year IS NOT NULL AND fiscal_year <> ''
  `);
  return (rows as unknown as { fiscalYear: string }[]).map((row) => row.fiscalYear);
}

type EmployeeRow = Omit<
  Employee,
  "grossTaxableIncomeNu" | "providentFundNu" | "specificDeductionNu" | "tdsBasisNu" | "taxOnSalaryNu" | "healthContributionNu" | "deductionsNu"
>;

async function selectEmployees(executor: DbExecutor): Promise<EmployeeRow[]> {
  const rows = await executor.execute<EmployeeRow>(raw`
    SELECT
      id,
      employee_number AS "employeeNumber",
      cid,
      tpn,
      email,
      full_name       AS "fullName",
      designation,
      department,
      account_number  AS "accountNumber",
      bank_name       AS "bankName",
      COALESCE(NULLIF(basic_pay_nu, 0), gross_pay_nu) AS "basicPayNu",
      COALESCE(allowances_nu, 0) AS "allowancesNu",
      COALESCE(arrear_nu, 0)     AS "arrearNu",
      gross_pay_nu               AS "grossPayNu",
      COALESCE(advance_nu, 0)    AS "advanceNu",
      status,
      created_at AS "createdAt"
    FROM employees
    ORDER BY id DESC
  `);
  return rows as unknown as EmployeeRow[];
}

async function selectDepartments(executor: DbExecutor): Promise<Department[]> {
  const rows = await executor.execute<Department>(raw`
    SELECT
      d.id,
      d.name,
      d.created_by AS "createdBy",
      d.created_at AS "createdAt",
      creator.display_name AS "createdByName",
      (SELECT COUNT(*) FROM employees e WHERE e.department = d.name) AS "employeeCount"
    FROM departments d
    LEFT JOIN users creator ON creator.id = d.created_by
    ORDER BY lower(d.name)
  `);
  return rows as unknown as Department[];
}

async function selectPayrollRuns(executor: DbExecutor, fiscalYear: string): Promise<PayrollRun[]> {
  const rows = await executor.execute<PayrollRun>(raw`
    SELECT
      pr.id,
      pr.fiscal_year AS "fiscalYear",
      pr.pay_month   AS "payMonth",
      pr.department,
      pr.budget_activity_id AS "budgetActivityId",
      a.obc        AS "budgetActivityObc",
      a.activity   AS "budgetActivityName",
      a.financing  AS "budgetActivityFinancing",
      a.approved_nu - COALESCE((
        SELECT SUM(line.amount_nu)
        FROM voucher_budget_lines line
        JOIN vouchers v ON v.id = line.voucher_id
        WHERE line.activity_id = pr.budget_activity_id
          AND v.voucher_type <> 'Advance'
          AND v.status IN ('Approved','Paid')
      ), 0) AS "budgetActivityAvailableNu",
      pr.employee_count         AS "employeeCount",
      pr.basic_pay_nu           AS "basicPayNu",
      pr.allowances_nu          AS "allowancesNu",
      pr.arrear_nu              AS "arrearNu",
      pr.gross_pay_nu           AS "grossPayNu",
      pr.tax_on_salary_nu       AS "taxOnSalaryNu",
      pr.health_contribution_nu AS "healthContributionNu",
      pr.advance_nu             AS "advanceNu",
      pr.recoveries_nu          AS "recoveriesNu",
      pr.net_pay_nu             AS "netPayNu",
      pr.status,
      pr.finalized_by      AS "finalizedBy",
      pr.finalized_at      AS "finalizedAt",
      pr.posted_by         AS "postedBy",
      pr.posted_at         AS "postedAt",
      pr.posting_undone_at AS "postingUndoneAt",
      finalizer.display_name AS "finalizedByName",
      poster.display_name    AS "postedByName",
      (SELECT string_agg(v.voucher_number, ', ' ORDER BY v.id) FROM vouchers v WHERE v.payroll_run_id = pr.id) AS "voucherNumbers",
      (SELECT COUNT(*) FROM vouchers v WHERE v.payroll_run_id = pr.id) AS "voucherCount",
      (SELECT COUNT(*) FROM vouchers v WHERE v.payroll_run_id = pr.id AND v.status IN ('Approved','Paid')) AS "approvedVoucherCount"
    FROM payroll_runs pr
    LEFT JOIN budget_activities a ON a.id = pr.budget_activity_id
    LEFT JOIN users finalizer ON finalizer.id = pr.finalized_by
    LEFT JOIN users poster ON poster.id = pr.posted_by
    WHERE pr.fiscal_year = ${fiscalYear}
    ORDER BY pr.pay_month DESC, pr.department
  `);
  return rows as unknown as PayrollRun[];
}

async function selectPayrollRunItems(executor: DbExecutor, fiscalYear: string): Promise<PayrollRunItem[]> {
  const rows = await executor.execute<PayrollRunItem>(raw`
    SELECT
      pri.id,
      pri.payroll_run_id AS "payrollRunId",
      pri.employee_id    AS "employeeId",
      pri.employee_number AS "employeeNumber",
      pri.cid,
      pri.tpn,
      pri.email,
      pri.full_name   AS "fullName",
      pri.designation,
      pri.department,
      pri.basic_pay_nu  AS "basicPayNu",
      pri.allowances_nu AS "allowancesNu",
      pri.arrear_nu     AS "arrearNu",
      pri.gross_pay_nu  AS "grossPayNu",
      pri.tax_on_salary_nu AS "taxOnSalaryNu",
      pri.health_contribution_nu AS "healthContributionNu",
      pri.advance_nu   AS "advanceNu",
      pri.recoveries_nu AS "deductionsNu",
      pri.net_pay_nu   AS "netPayNu",
      pri.payslip_email_id AS "payslipEmailId",
      pri.payslip_sent_at  AS "payslipSentAt"
    FROM payroll_run_items pri
    JOIN payroll_runs pr ON pr.id = pri.payroll_run_id
    WHERE pr.fiscal_year = ${fiscalYear}
    ORDER BY pri.payroll_run_id DESC, pri.employee_number
  `);
  return rows as unknown as PayrollRunItem[];
}

async function selectPayrollRemittanceRuns(executor: DbExecutor, fiscalYear: string): Promise<PayrollRemittanceRun[]> {
  const rows = await executor.execute<PayrollRemittanceRun>(raw`
    SELECT
      rr.id,
      rr.fiscal_year AS "fiscalYear",
      rr.pay_month   AS "payMonth",
      rr.employee_count AS "employeeCount",
      rr.tax_on_salary_nu AS "taxOnSalaryNu",
      rr.health_contribution_nu AS "healthContributionNu",
      rr.total_remittance_nu AS "totalRemittanceNu",
      rr.status,
      rr.finalized_by AS "finalizedBy",
      rr.finalized_at AS "finalizedAt",
      rr.posted_by AS "postedBy",
      rr.posted_at AS "postedAt",
      finalizer.display_name AS "finalizedByName",
      poster.display_name AS "postedByName",
      (SELECT string_agg(v.voucher_number, ', ' ORDER BY v.id) FROM vouchers v WHERE v.payroll_remittance_run_id = rr.id) AS "voucherNumbers"
    FROM payroll_remittance_runs rr
    LEFT JOIN users finalizer ON finalizer.id = rr.finalized_by
    LEFT JOIN users poster ON poster.id = rr.posted_by
    WHERE rr.fiscal_year = ${fiscalYear}
    ORDER BY rr.pay_month DESC
  `);
  return rows as unknown as PayrollRemittanceRun[];
}

async function selectSupplierTdsRemittanceRuns(
  executor: DbExecutor,
  fiscalYear: string,
): Promise<SupplierTdsRemittanceRun[]> {
  const rows = await executor.execute<SupplierTdsRemittanceRun>(raw`
    SELECT
      sr.id,
      sr.fiscal_year AS "fiscalYear",
      sr.pay_month   AS "payMonth",
      sr.tds_rate    AS "tdsRate",
      sr.source_voucher_count AS "sourceVoucherCount",
      sr.total_remittance_nu  AS "totalRemittanceNu",
      sr.status,
      sr.finalized_by AS "finalizedBy",
      sr.finalized_at AS "finalizedAt",
      finalizer.display_name AS "finalizedByName",
      (SELECT v.voucher_number FROM vouchers v WHERE v.supplier_tds_remittance_run_id = sr.id ORDER BY v.id DESC LIMIT 1) AS "voucherNumber",
      (SELECT v.status FROM vouchers v WHERE v.supplier_tds_remittance_run_id = sr.id ORDER BY v.id DESC LIMIT 1) AS "voucherStatus"
    FROM supplier_tds_remittance_runs sr
    LEFT JOIN users finalizer ON finalizer.id = sr.finalized_by
    WHERE sr.fiscal_year = ${fiscalYear}
    ORDER BY sr.pay_month DESC, sr.tds_rate
  `);
  return rows as unknown as SupplierTdsRemittanceRun[];
}

async function selectUsers(executor: DbExecutor): Promise<ManagedUser[]> {
  const rows = await executor.execute<Omit<ManagedUser, "roleLabel">>(raw`
    SELECT
      id,
      username,
      cid,
      display_name AS "displayName",
      designation,
      role,
      must_change_password AS "mustChangePassword",
      active,
      last_login_at     AS "lastLoginAt",
      invitation_sent_at AS "invitationSentAt",
      deleted_at        AS "deletedAt",
      deleted_by        AS "deletedBy",
      created_at        AS "createdAt"
    FROM users
    ORDER BY id
  `);
  return (rows as unknown as Omit<ManagedUser, "roleLabel">[]).map((user) => ({
    ...user,
    roleLabel: roleLabels[user.role as AppRole],
  }));
}

async function selectBudgetReappropriations(
  executor: DbExecutor,
  fiscalYear: string,
): Promise<BudgetReappropriation[]> {
  const rows = await executor.execute<BudgetReappropriation>(raw`
    SELECT
      transfer.id,
      transfer.fiscal_year AS "fiscalYear",
      transfer.source_activity_id AS "sourceActivityId",
      source.obc      AS "sourceObc",
      source.activity AS "sourceActivity",
      transfer.destination_activity_id AS "destinationActivityId",
      destination.obc      AS "destinationObc",
      destination.activity AS "destinationActivity",
      transfer.amount_nu AS "amountNu",
      transfer.reason,
      transfer.transferred_by AS "transferredBy",
      "user".display_name AS "transferredByName",
      transfer.transferred_at AS "transferredAt"
    FROM budget_reappropriations transfer
    JOIN budget_activities source ON source.id = transfer.source_activity_id
    JOIN budget_activities destination ON destination.id = transfer.destination_activity_id
    LEFT JOIN users "user" ON "user".id = transfer.transferred_by
    WHERE transfer.fiscal_year = ${fiscalYear}
    ORDER BY transfer.transferred_at DESC, transfer.id DESC
  `);
  return rows as unknown as BudgetReappropriation[];
}

async function selectSupplementaryBudgets(executor: DbExecutor, fiscalYear: string): Promise<SupplementaryBudget[]> {
  const rows = await executor.execute<SupplementaryBudget>(raw`
    SELECT
      supplement.id,
      supplement.fiscal_year AS "fiscalYear",
      supplement.activity_id AS "activityId",
      activity.obc,
      activity.activity,
      activity.category,
      supplement.amount_nu AS "amountNu",
      supplement.reason,
      supplement.granted_by AS "grantedBy",
      "user".display_name AS "grantedByName",
      supplement.granted_at AS "grantedAt"
    FROM supplementary_budgets supplement
    JOIN budget_activities activity ON activity.id = supplement.activity_id
    LEFT JOIN users "user" ON "user".id = supplement.granted_by
    WHERE supplement.fiscal_year = ${fiscalYear}
    ORDER BY supplement.granted_at DESC, supplement.id DESC
  `);
  return rows as unknown as SupplementaryBudget[];
}

/* -------------------------------------------------------------------------- */
/* Shared balance helpers used by the write services                          */
/* -------------------------------------------------------------------------- */

export type ActivityBalance = {
  id: number;
  obc: string;
  activity: string;
  approvedNu: number;
  committedNu: number;
  availableNu: number;
};

/** Approved less everything already committed by approved or paid vouchers. */
export async function loadActivityBalances(
  executor: DbExecutor,
  fiscalYear: string,
  activityIds: number[],
  forUpdate = false,
): Promise<Map<number, ActivityBalance>> {
  if (!activityIds.length) return new Map();

  const idList = raw.join(
    activityIds.map((id) => raw`${id}`),
    raw`, `,
  );

  const rows = await executor.execute<ActivityBalance>(raw`
    SELECT
      a.id,
      a.obc,
      a.activity,
      a.approved_nu AS "approvedNu",
      COALESCE((
        SELECT SUM(line.amount_nu)
        FROM voucher_budget_lines line
        JOIN vouchers v ON v.id = line.voucher_id
        WHERE line.activity_id = a.id
          AND v.voucher_type <> 'Advance'
          AND v.status IN ('Approved','Paid')
      ), 0) AS "committedNu",
      a.approved_nu - COALESCE((
        SELECT SUM(line.amount_nu)
        FROM voucher_budget_lines line
        JOIN vouchers v ON v.id = line.voucher_id
        WHERE line.activity_id = a.id
          AND v.voucher_type <> 'Advance'
          AND v.status IN ('Approved','Paid')
      ), 0) AS "availableNu"
    FROM budget_activities a
    WHERE a.fiscal_year = ${fiscalYear}
      AND a.id IN (${idList})
    ${forUpdate ? raw`FOR UPDATE OF a` : raw``}
  `);

  return new Map((rows as unknown as ActivityBalance[]).map((row) => [row.id, row]));
}

export type OutstandingAdvance = {
  id: number;
  voucherNumber: string;
  payee: string;
  advanceNu: number;
  outstandingNu: number;
};

/** Advance still recoverable: original amount less approved/paid recoveries. */
export async function loadOutstandingAdvance(
  executor: DbExecutor,
  advanceVoucherId: number,
  fiscalYear: string,
): Promise<OutstandingAdvance | null> {
  const rows = await executor.execute<OutstandingAdvance>(raw`
    SELECT
      av.id,
      av.voucher_number AS "voucherNumber",
      av.payee,
      av.amount_nu AS "advanceNu",
      av.amount_nu - COALESCE(SUM(CASE WHEN recovery.status IN ('Approved','Paid') THEN recovery.advance_recovery_nu ELSE 0 END), 0) AS "outstandingNu"
    FROM vouchers av
    LEFT JOIN vouchers recovery ON recovery.advance_recovery_voucher_id = av.id
    WHERE av.id = ${advanceVoucherId}
      AND av.fiscal_year = ${fiscalYear}
      AND av.voucher_type = 'Advance'
      AND av.status IN ('Approved','Paid')
    GROUP BY av.id
  `);
  const [row] = rows as unknown as OutstandingAdvance[];
  return row ?? null;
}

/** Next `PV.7.03`-style serial for a voucher type within a fiscal month. */
export async function nextVoucherSerial(
  executor: DbExecutor,
  fiscalYear: string,
  voucherType: string,
  monthKey: string,
): Promise<number> {
  const rows = await executor.execute<{ highest: number }>(raw`
    SELECT COALESCE(MAX(NULLIF(split_part(voucher_number, '.', 3), '')::int), 0) AS "highest"
    FROM vouchers
    WHERE fiscal_year = ${fiscalYear}
      AND voucher_type = ${voucherType}
      AND substr(transaction_date, 6, 2) = ${monthKey}
  `);
  const [row] = rows as unknown as { highest: number }[];
  return (row?.highest ?? 0) + 1;
}