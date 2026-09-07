/**
 * Pelsung Finance — Postgres schema (Supabase).
 *
 * Money is stored as `numeric(14, 2)` — Ngultrum with 2 decimal places
 * (chhertum). The postgres-js driver (see db/client.ts) parses numeric into a
 * JS `number` on read and serialises numbers on write, so `.$type<number>()`
 * keeps the application working in plain numbers. The application validates a
 * Nu. 1,000,000,000,000 ceiling and rounds to 2 places on every write.
 *
 * Timestamps are stored as `timestamptz` and exposed to the API layer as ISO
 * strings so the client contract is identical to the previous SQLite build.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Ngultrum money column, 2 decimal places, typed as a JS number. */
const nu = (name: string) => numeric(name, { precision: 14, scale: 2 }).$type<number>();

/* -------------------------------------------------------------------------- */
/* Identity and access                                                        */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /** Email address used as the sign-in user ID; always lower-cased. */
    username: text("username").notNull(),
    cid: text("cid"),
    displayName: text("display_name").notNull(),
    designation: text("designation").notNull().default("Not assigned"),
    role: text("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    invitationEmailId: text("invitation_email_id"),
    invitationSentAt: timestamp("invitation_sent_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: integer("deleted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_cid_unique").on(table.cid),
    index("users_role_idx").on(table.role),
    check("users_role_check", sql`${table.role} in ('agency_user','agency_admin','approving_authority','viewer')`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_user_idx").on(table.userId),
    index("audit_logs_created_idx").on(table.createdAt.desc()),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Budget                                                                     */
/* -------------------------------------------------------------------------- */

export const budgetActivities = pgTable(
  "budget_activities",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull().default("2026-2027"),
    category: text("category").notNull(),
    financing: text("financing").notNull(),
    obc: text("obc").notNull(),
    activity: text("activity").notNull(),
    budgetType: text("budget_type").notNull(),
    approvedNu: nu("approved_nu").notNull(),
    brief: text("brief").notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("budget_activities_fiscal_year_idx").on(table.fiscalYear),
    // Deliberately not unique: the approved budget carries the same OBC and
    // activity title under different programmes (for example "01.01 Pay and
    // Allowances" for both the Secretariat and the Innovation Lab). New manual
    // entries are still de-duplicated per programme in the budget service.
    index("budget_activities_year_obc_idx").on(table.fiscalYear, table.obc),
    check("budget_activities_type_check", sql`${table.budgetType} in ('Current','Capital')`),
    check("budget_activities_approved_check", sql`${table.approvedNu} >= 0`),
  ],
);

export const budgetReappropriations = pgTable(
  "budget_reappropriations",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    sourceActivityId: integer("source_activity_id")
      .notNull()
      .references(() => budgetActivities.id),
    destinationActivityId: integer("destination_activity_id")
      .notNull()
      .references(() => budgetActivities.id),
    amountNu: nu("amount_nu").notNull(),
    reason: text("reason").notNull(),
    transferredBy: integer("transferred_by")
      .notNull()
      .references(() => users.id),
    transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("budget_reappropriations_fiscal_year_date_idx").on(table.fiscalYear, table.transferredAt.desc()),
    index("budget_reappropriations_source_idx").on(table.sourceActivityId),
    index("budget_reappropriations_destination_idx").on(table.destinationActivityId),
    check("budget_reappropriations_amount_check", sql`${table.amountNu} > 0`),
    check("budget_reappropriations_distinct_check", sql`${table.sourceActivityId} <> ${table.destinationActivityId}`),
  ],
);

export const supplementaryBudgets = pgTable(
  "supplementary_budgets",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    activityId: integer("activity_id")
      .notNull()
      .references(() => budgetActivities.id),
    amountNu: nu("amount_nu").notNull(),
    reason: text("reason").notNull(),
    grantedBy: integer("granted_by")
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("supplementary_budgets_fiscal_year_date_idx").on(table.fiscalYear, table.grantedAt.desc()),
    index("supplementary_budgets_activity_idx").on(table.activityId),
    check("supplementary_budgets_amount_check", sql`${table.amountNu} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Payroll master data                                                        */
/* -------------------------------------------------------------------------- */

export const departments = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("departments_name_unique").on(sql`lower(${table.name})`)],
);

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    employeeNumber: text("employee_number").notNull(),
    cid: text("cid"),
    tpn: text("tpn"),
    fullName: text("full_name").notNull(),
    email: text("email"),
    designation: text("designation").notNull(),
    department: text("department").notNull(),
    // Bank details for salary credit.
    accountNumber: text("account_number"),
    bankName: text("bank_name"),
    basicPayNu: nu("basic_pay_nu").notNull().default(0),
    allowancesNu: nu("allowances_nu").notNull().default(0),
    arrearNu: nu("arrear_nu").notNull().default(0),
    grossPayNu: nu("gross_pay_nu").notNull(),
    taxOnSalaryNu: nu("tax_on_salary_nu").notNull().default(0),
    healthContributionNu: nu("health_contribution_nu").notNull().default(0),
    advanceNu: nu("advance_nu").notNull().default(0),
    deductionsNu: nu("deductions_nu").notNull().default(0),
    status: text("status").notNull().default("Active"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("employees_number_unique").on(table.employeeNumber),
    uniqueIndex("employees_cid_unique").on(table.cid),
    uniqueIndex("employees_tpn_unique").on(table.tpn),
    uniqueIndex("employees_email_unique").on(table.email),
    index("employees_department_idx").on(table.department),
    index("employees_status_idx").on(table.status),
    check("employees_status_check", sql`${table.status} in ('Active','Inactive')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Payroll runs                                                               */
/* -------------------------------------------------------------------------- */

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    payMonth: text("pay_month").notNull(),
    department: text("department").notNull().default("All Departments"),
    budgetActivityId: integer("budget_activity_id").references(() => budgetActivities.id),
    employeeCount: integer("employee_count").notNull(),
    basicPayNu: nu("basic_pay_nu").notNull(),
    allowancesNu: nu("allowances_nu").notNull(),
    arrearNu: nu("arrear_nu").notNull(),
    grossPayNu: nu("gross_pay_nu").notNull(),
    taxOnSalaryNu: nu("tax_on_salary_nu").notNull(),
    healthContributionNu: nu("health_contribution_nu").notNull(),
    advanceNu: nu("advance_nu").notNull(),
    recoveriesNu: nu("recoveries_nu").notNull(),
    netPayNu: nu("net_pay_nu").notNull(),
    status: text("status").notNull().default("Finalized"),
    finalizedBy: integer("finalized_by")
      .notNull()
      .references(() => users.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
    postedBy: integer("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postingUndoneAt: timestamp("posting_undone_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payroll_runs_month_department_unique").on(table.fiscalYear, table.payMonth, table.department),
    index("payroll_runs_period_idx").on(table.fiscalYear, table.payMonth.desc(), table.department),
    index("payroll_runs_budget_activity_idx").on(table.budgetActivityId),
    index("payroll_runs_status_idx").on(table.status),
    check("payroll_runs_status_check", sql`${table.status} in ('Finalized','Posted')`),
  ],
);

export const payrollRunItems = pgTable(
  "payroll_run_items",
  {
    id: serial("id").primaryKey(),
    payrollRunId: integer("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id),
    employeeNumber: text("employee_number").notNull(),
    cid: text("cid"),
    tpn: text("tpn"),
    fullName: text("full_name").notNull(),
    email: text("email"),
    designation: text("designation").notNull(),
    department: text("department").notNull(),
    basicPayNu: nu("basic_pay_nu").notNull(),
    allowancesNu: nu("allowances_nu").notNull(),
    arrearNu: nu("arrear_nu").notNull(),
    grossPayNu: nu("gross_pay_nu").notNull(),
    taxOnSalaryNu: nu("tax_on_salary_nu").notNull(),
    healthContributionNu: nu("health_contribution_nu").notNull(),
    advanceNu: nu("advance_nu").notNull(),
    recoveriesNu: nu("recoveries_nu").notNull(),
    netPayNu: nu("net_pay_nu").notNull(),
    payslipEmailId: text("payslip_email_id"),
    payslipSentAt: timestamp("payslip_sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payroll_run_items_employee_unique").on(table.payrollRunId, table.employeeId),
    index("payroll_run_items_run_idx").on(table.payrollRunId),
  ],
);

export const payrollRemittanceRuns = pgTable(
  "payroll_remittance_runs",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    payMonth: text("pay_month").notNull(),
    employeeCount: integer("employee_count").notNull(),
    taxOnSalaryNu: nu("tax_on_salary_nu").notNull(),
    healthContributionNu: nu("health_contribution_nu").notNull(),
    totalRemittanceNu: nu("total_remittance_nu").notNull(),
    status: text("status").notNull().default("Finalized"),
    finalizedBy: integer("finalized_by")
      .notNull()
      .references(() => users.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
    postedBy: integer("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payroll_remittance_runs_month_unique").on(table.fiscalYear, table.payMonth),
    index("payroll_remittance_runs_fiscal_year_idx").on(table.fiscalYear),
    check("payroll_remittance_runs_status_check", sql`${table.status} in ('Finalized','Posted')`),
  ],
);

export const supplierTdsRemittanceRuns = pgTable(
  "supplier_tds_remittance_runs",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    payMonth: text("pay_month").notNull(),
    tdsRate: integer("tds_rate").notNull(),
    sourceVoucherCount: integer("source_voucher_count").notNull(),
    totalRemittanceNu: nu("total_remittance_nu").notNull(),
    status: text("status").notNull().default("Posted"),
    finalizedBy: integer("finalized_by")
      .notNull()
      .references(() => users.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("supplier_tds_remittance_runs_period_idx").on(table.fiscalYear, table.payMonth, table.tdsRate),
    uniqueIndex("supplier_tds_remittance_runs_active_period_unique")
      .on(table.fiscalYear, table.payMonth, table.tdsRate)
      .where(sql`status <> 'Reversed'`),
    check("supplier_tds_remittance_runs_rate_check", sql`${table.tdsRate} in (2,5)`),
    check("supplier_tds_remittance_runs_status_check", sql`${table.status} in ('Posted','Reversed')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Vouchers                                                                   */
/* -------------------------------------------------------------------------- */

export const vouchers = pgTable(
  "vouchers",
  {
    id: serial("id").primaryKey(),
    voucherNumber: text("voucher_number").notNull(),
    activityId: integer("activity_id").references(() => budgetActivities.id),
    fiscalYear: text("fiscal_year").notNull().default("2026-2027"),
    voucherType: text("voucher_type").notNull(),
    payee: text("payee").notNull(),
    tpn: text("tpn"),
    // Payee bank details for the payment.
    payeeAccountNumber: text("payee_account_number"),
    payeeBankName: text("payee_bank_name"),
    billReference: text("bill_reference"),
    description: text("description").notNull(),
    amountNu: nu("amount_nu").notNull(),
    gstNu: nu("gst_nu").notNull().default(0),
    tdsRate: integer("tds_rate").notNull().default(0),
    tdsNu: nu("tds_nu").notNull().default(0),
    advanceRecoveryNu: nu("advance_recovery_nu").notNull().default(0),
    advanceRecoveryVoucherId: integer("advance_recovery_voucher_id"),
    netPaymentNu: nu("net_payment_nu").notNull().default(0),
    payrollRunId: integer("payroll_run_id").references(() => payrollRuns.id),
    payrollRemittanceRunId: integer("payroll_remittance_run_id").references(() => payrollRemittanceRuns.id),
    supplierTdsRemittanceRunId: integer("supplier_tds_remittance_run_id").references(() => supplierTdsRemittanceRuns.id),
    payrollEntryType: text("payroll_entry_type"),
    payrollHealthContributionNu: nu("payroll_health_contribution_nu").notNull().default(0),
    status: text("status").notNull(),
    /** Calendar date (YYYY-MM-DD) of the transaction, kept as text for exact fiscal reporting. */
    transactionDate: text("transaction_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reversedBy: integer("reversed_by").references(() => users.id, { onDelete: "set null" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalReason: text("reversal_reason"),
  },
  (table) => [
    uniqueIndex("vouchers_number_unique").on(table.voucherNumber),
    index("vouchers_activity_idx").on(table.activityId),
    index("vouchers_fiscal_year_id_idx").on(table.fiscalYear, table.id.desc()),
    index("vouchers_advance_recovery_idx").on(table.advanceRecoveryVoucherId),
    index("vouchers_payroll_run_idx").on(table.payrollRunId),
    index("vouchers_payroll_remittance_run_idx").on(table.payrollRemittanceRunId),
    index("vouchers_supplier_tds_remittance_run_idx").on(table.supplierTdsRemittanceRunId),
    index("vouchers_status_idx").on(table.status),
    index("vouchers_transaction_date_idx").on(table.transactionDate),
    check("vouchers_type_check", sql`${table.voucherType} in ('Payment','Journal','Receipt','Advance')`),
    check(
      "vouchers_status_check",
      sql`${table.status} in ('Draft','Pending','Approved','Paid','Rejected','Reversed')`,
    ),
    check("vouchers_tds_rate_check", sql`${table.tdsRate} in (0,2,5)`),
    check("vouchers_amount_check", sql`${table.amountNu} > 0`),
  ],
);

export const voucherBudgetLines = pgTable(
  "voucher_budget_lines",
  {
    id: serial("id").primaryKey(),
    voucherId: integer("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    activityId: integer("activity_id")
      .notNull()
      .references(() => budgetActivities.id),
    amountNu: nu("amount_nu").notNull(),
  },
  (table) => [
    uniqueIndex("voucher_budget_lines_voucher_activity_unique").on(table.voucherId, table.activityId),
    index("voucher_budget_lines_voucher_idx").on(table.voucherId),
    index("voucher_budget_lines_activity_idx").on(table.activityId),
    check("voucher_budget_lines_amount_check", sql`${table.amountNu} > 0`),
  ],
);

export const supplierTdsRemittanceItems = pgTable(
  "supplier_tds_remittance_items",
  {
    id: serial("id").primaryKey(),
    remittanceRunId: integer("remittance_run_id")
      .notNull()
      .references(() => supplierTdsRemittanceRuns.id, { onDelete: "cascade" }),
    voucherId: integer("voucher_id")
      .notNull()
      .references(() => vouchers.id),
    tdsNu: nu("tds_nu").notNull(),
  },
  (table) => [
    uniqueIndex("supplier_tds_remittance_items_run_voucher_unique").on(table.remittanceRunId, table.voucherId),
    index("supplier_tds_remittance_items_run_idx").on(table.remittanceRunId),
    index("supplier_tds_remittance_items_voucher_idx").on(table.voucherId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Bank reconciliation and month close                                        */
/* -------------------------------------------------------------------------- */

export const bankReconciliations = pgTable(
  "bank_reconciliations",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    accountNumber: text("account_number").notNull(),
    statementMonth: text("statement_month").notNull(),
    totalFundsReceivedNu: nu("total_funds_received_nu").notNull().default(0),
    closingCashBookBalanceNu: nu("closing_cash_book_balance_nu").notNull().default(0),
    cashBookWithdrawalsNu: nu("cash_book_withdrawals_nu").notNull().default(0),
    bankStatementWithdrawalsNu: nu("bank_statement_withdrawals_nu").notNull().default(0),
    additionsNu: nu("additions_nu").notNull().default(0),
    deductionsNu: nu("deductions_nu").notNull().default(0),
    reconciliationTotalNu: nu("reconciliation_total_nu").notNull().default(0),
    differenceNu: nu("difference_nu").notNull().default(0),
    status: text("status").notNull().default("Draft"),
    preparedBy: integer("prepared_by").notNull().references(() => users.id),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer("updated_by").notNull().references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedBy: integer("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bank_reconciliations_period_unique").on(table.fiscalYear, table.accountNumber, table.statementMonth),
    index("bank_reconciliations_fiscal_year_month_idx").on(table.fiscalYear, table.statementMonth),
    index("bank_reconciliations_status_idx").on(table.status),
    check("bank_reconciliations_status_check", sql`${table.status} in ('Draft','Reconciled','Closed')`),
  ],
);

export const bankReconciliationItems = pgTable(
  "bank_reconciliation_items",
  {
    id: serial("id").primaryKey(),
    reconciliationId: integer("reconciliation_id")
      .notNull()
      .references(() => bankReconciliations.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull(),
    transactionDate: text("transaction_date"),
    reference: text("reference").notNull().default(""),
    particulars: text("particulars").notNull(),
    amountNu: nu("amount_nu").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bank_reconciliation_items_reconciliation_idx").on(table.reconciliationId, table.itemType),
    check("bank_reconciliation_items_type_check", sql`${table.itemType} in ('add','less')`),
  ],
);

export const monthClosures = pgTable(
  "month_closures",
  {
    id: serial("id").primaryKey(),
    fiscalYear: text("fiscal_year").notNull(),
    accountNumber: text("account_number").notNull(),
    closeMonth: text("close_month").notNull(),
    status: text("status").notNull().default("Closed"),
    closedBy: integer("closed_by").notNull().references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("month_closures_period_unique").on(table.fiscalYear, table.accountNumber, table.closeMonth),
    index("month_closures_fiscal_year_month_idx").on(table.fiscalYear, table.closeMonth),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations (used by drizzle's relational queries)                           */
/* -------------------------------------------------------------------------- */

export const voucherRelations = relations(vouchers, ({ one, many }) => ({
  activity: one(budgetActivities, { fields: [vouchers.activityId], references: [budgetActivities.id] }),
  budgetLines: many(voucherBudgetLines),
  payrollRun: one(payrollRuns, { fields: [vouchers.payrollRunId], references: [payrollRuns.id] }),
}));

export const voucherBudgetLineRelations = relations(voucherBudgetLines, ({ one }) => ({
  voucher: one(vouchers, { fields: [voucherBudgetLines.voucherId], references: [vouchers.id] }),
  activity: one(budgetActivities, { fields: [voucherBudgetLines.activityId], references: [budgetActivities.id] }),
}));

export const payrollRunRelations = relations(payrollRuns, ({ many, one }) => ({
  items: many(payrollRunItems),
  budgetActivity: one(budgetActivities, {
    fields: [payrollRuns.budgetActivityId],
    references: [budgetActivities.id],
  }),
}));

export const payrollRunItemRelations = relations(payrollRunItems, ({ one }) => ({
  run: one(payrollRuns, { fields: [payrollRunItems.payrollRunId], references: [payrollRuns.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type VoucherRow = typeof vouchers.$inferSelect;
export type BudgetActivityRow = typeof budgetActivities.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;
export type PayrollRunRow = typeof payrollRuns.$inferSelect;
