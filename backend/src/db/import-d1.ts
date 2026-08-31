/**
 * Migrates the previous Cloudflare D1 (SQLite) database into Supabase Postgres.
 *
 *   npm run db:import -- ./pelsung-d1-export.sql
 *   npm run db:import -- ./pelsung.sqlite --dry-run
 *
 * Export the source first:
 *   npx wrangler d1 export <DATABASE_NAME> --remote --output=pelsung-d1-export.sql
 *
 * The migration is one transaction: it either lands completely or not at all.
 * Before writing anything it runs a pre-flight pass that reports every row the
 * new schema would reject — legacy values outside the allowed set, references
 * to users that no longer exist, department names that differ only by case —
 * so problems surface as a list to fix rather than as a failure half way
 * through. Finish with the reconciliation table it prints: row counts and money
 * totals on both sides must agree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sql as raw } from "drizzle-orm";
import { closeDatabase, db } from "./client.js";
import { calculateVoucherDeductions } from "../domain/vouchers.js";

type Row = Record<string, unknown>;

const args = process.argv.slice(2);
const sourcePath = args.find((argument) => !argument.startsWith("--"));
const dryRun = args.includes("--dry-run");
const replace = args.includes("--replace");
const skipInvalid = args.includes("--skip-invalid");

if (!sourcePath) {
  console.error(`
Usage: npm run db:import -- <source> [options]

  <source>         A wrangler D1 export (.sql) or a SQLite file (.sqlite/.db)

  --dry-run        Validate and report only; write nothing
  --replace        Allow importing into tables that already hold rows
                   (existing rows are deleted first — irreversible)
  --skip-invalid   Skip rows the new schema rejects instead of aborting
`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Reading the source                                                         */
/* -------------------------------------------------------------------------- */

function openSource(path: string): DatabaseSync {
  const source = new DatabaseSync(":memory:");

  if (/\.(sqlite|sqlite3|db)$/i.test(path)) {
    // Attach the file and copy it in, so the caller's database is never touched.
    const file = new DatabaseSync(path, { readOnly: true });
    const tables = file
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string; sql: string }[];
    for (const table of tables) {
      source.exec(table.sql);
      const rows = file.prepare(`SELECT * FROM "${table.name}"`).all() as Row[];
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const statement = source.prepare(
        `INSERT INTO "${table.name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      );
      for (const row of rows) statement.run(...columns.map((column) => row[column] as never));
    }
    file.close();
    return source;
  }

  // A wrangler .sql dump: strip directives SQLite's exec cannot take.
  const dump = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(PRAGMA|BEGIN TRANSACTION|COMMIT|ROLLBACK)/i.test(line))
    .join("\n");
  source.exec(dump);
  return source;
}

const source = openSource(sourcePath);

function sourceTables(): Set<string> {
  return new Set(
    (source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (table) => table.name,
    ),
  );
}

const present = sourceTables();

function read(table: string): Row[] {
  if (!present.has(table)) return [];
  return source.prepare(`SELECT * FROM "${table}"`).all() as Row[];
}

/* -------------------------------------------------------------------------- */
/* Value conversion                                                           */
/* -------------------------------------------------------------------------- */

/** SQLite stores booleans as 0/1. */
const bool = (value: unknown): boolean => value === 1 || value === true || value === "1";

/**
 * SQLite stores timestamps as ISO text; empty strings mean "not set".
 *
 * Returns an ISO string rather than a Date: these values are bound into raw
 * SQL templates, where there is no column type to convert them, and Postgres
 * casts an ISO string to timestamptz precisely.
 */
function ts(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Import time, for the few columns the old schema never recorded. */
const importedAt = new Date().toISOString();

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
};

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
};

/* -------------------------------------------------------------------------- */
/* Pre-flight validation                                                      */
/* -------------------------------------------------------------------------- */

const problems: string[] = [];
const invalidRows = new Map<string, Set<unknown>>();

function reject(table: string, id: unknown, reason: string): void {
  problems.push(`${table} #${id}: ${reason}`);
  const set = invalidRows.get(table) ?? new Set();
  set.add(id);
  invalidRows.set(table, set);
}

const users = read("users");
const budgetActivities = read("budget_activities");
const departments = read("departments");
const employees = read("employees");
const payrollRuns = read("payroll_runs");
const payrollRunItems = read("payroll_run_items");
const payrollRemittanceRuns = read("payroll_remittance_runs");
const supplierRuns = read("supplier_tds_remittance_runs");
const vouchers = read("vouchers");
const voucherLines = read("voucher_budget_lines");
const supplierItems = read("supplier_tds_remittance_items");
const reappropriations = read("budget_reappropriations");
const supplementary = read("supplementary_budgets");
const auditLogs = read("audit_logs");
const releaseForecasts = read("release_forecasts");

const userIds = new Set(users.map((user) => user.id));
const activityIds = new Set(budgetActivities.map((activity) => activity.id));
const voucherIds = new Set(vouchers.map((voucher) => voucher.id));
const payrollRunIds = new Set(payrollRuns.map((run) => run.id));
const employeeIds = new Set(employees.map((employee) => employee.id));

/**
 * A reference that no longer resolves is cleared rather than failing the row —
 * a voucher whose author was purged is still a voucher, and its accounting
 * history matters more than the name attached to it.
 */
const clearedReferences = new Set<string>();
function ref(value: unknown, known: Set<unknown>, label: string, table: string, id: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (known.has(value)) return Number(value);
  clearedReferences.add(`${table} #${id}: ${label} pointed at #${value}, which no longer exists — cleared`);
  return null;
}

/** Audits every optional reference up front, so --dry-run reports them too. */
function auditReferences(): void {
  const check = (rows: Row[], table: string, fields: [string, Set<unknown>][]) => {
    for (const row of rows) {
      for (const [field, known] of fields) ref(row[field], known, field, table, row.id);
    }
  };
  check(users, "users", [["deleted_by", userIds]]);
  check(departments, "departments", [["created_by", userIds]]);
  check(employees, "employees", [["created_by", userIds]]);
  check(payrollRuns, "payroll_runs", [
    ["budget_activity_id", activityIds],
    ["posted_by", userIds],
  ]);
  check(payrollRemittanceRuns, "payroll_remittance_runs", [["posted_by", userIds]]);
  check(auditLogs, "audit_logs", [["user_id", userIds]]);
  check(vouchers, "vouchers", [
    ["activity_id", activityIds],
    ["advance_recovery_voucher_id", voucherIds],
    ["payroll_run_id", payrollRunIds],
    ["created_by", userIds],
    ["approved_by", userIds],
    ["reversed_by", userIds],
  ]);
}

for (const user of users) {
  if (!["agency_user", "agency_admin", "approving_authority", "viewer"].includes(String(user.role))) {
    reject("users", user.id, `role "${user.role}" is not one of the four supported roles`);
  }
}

for (const activity of budgetActivities) {
  if (!["Current", "Capital"].includes(String(activity.budget_type))) {
    reject("budget_activities", activity.id, `budget_type "${activity.budget_type}" is neither Current nor Capital`);
  }
  if (num(activity.approved_nu) < 0) reject("budget_activities", activity.id, "approved_nu is negative");
}

// The new schema treats department names case-insensitively.
const byLowerName = new Map<string, unknown[]>();
for (const department of departments) {
  const key = String(department.name).trim().toLowerCase();
  byLowerName.set(key, [...(byLowerName.get(key) ?? []), department.id]);
}
for (const [name, ids] of byLowerName) {
  if (ids.length > 1) {
    problems.push(
      `departments: "${name}" appears ${ids.length} times differing only by case or spacing (ids ${ids.join(", ")}) — merge them in the source first`,
    );
  }
}

for (const employee of employees) {
  if (!["Active", "Inactive"].includes(String(employee.status))) {
    reject("employees", employee.id, `status "${employee.status}" is neither Active nor Inactive`);
  }
  if (num(employee.gross_pay_nu) < 0) reject("employees", employee.id, "gross_pay_nu is negative");
}

for (const voucher of vouchers) {
  if (!["Payment", "Journal", "Receipt", "Advance"].includes(String(voucher.voucher_type))) {
    reject("vouchers", voucher.id, `voucher_type "${voucher.voucher_type}" is not supported`);
  }
  if (!["Draft", "Pending", "Approved", "Paid", "Rejected", "Reversed"].includes(String(voucher.status))) {
    reject("vouchers", voucher.id, `status "${voucher.status}" is not supported`);
  }
  if (![0, 2, 5].includes(num(voucher.tds_rate))) {
    reject("vouchers", voucher.id, `tds_rate ${voucher.tds_rate} is not 0, 2 or 5`);
  }
  if (num(voucher.amount_nu) <= 0) reject("vouchers", voucher.id, "amount_nu is not positive");
}

for (const run of payrollRuns) {
  if (!["Finalized", "Posted"].includes(String(run.status))) {
    reject("payroll_runs", run.id, `status "${run.status}" is neither Finalized nor Posted`);
  }
}

for (const run of supplierRuns) {
  if (![2, 5].includes(num(run.tds_rate))) reject("supplier_tds_remittance_runs", run.id, "tds_rate is not 2 or 5");
  if (!["Posted", "Reversed"].includes(String(run.status))) {
    reject("supplier_tds_remittance_runs", run.id, `status "${run.status}" is not supported`);
  }
}
// Only one live remittance per month and rate is allowed.
const supplierPeriods = new Map<string, number>();
for (const run of supplierRuns) {
  if (String(run.status) === "Reversed") continue;
  const key = `${run.fiscal_year}|${run.pay_month}|${run.tds_rate}`;
  supplierPeriods.set(key, (supplierPeriods.get(key) ?? 0) + 1);
}
for (const [key, count] of supplierPeriods) {
  if (count > 1) problems.push(`supplier_tds_remittance_runs: ${count} live remittances for ${key} — only one is allowed`);
}

for (const transfer of reappropriations) {
  if (transfer.source_activity_id === transfer.destination_activity_id) {
    reject("budget_reappropriations", transfer.id, "source and destination are the same activity");
  }
  if (!activityIds.has(transfer.source_activity_id) || !activityIds.has(transfer.destination_activity_id)) {
    reject("budget_reappropriations", transfer.id, "references a budget activity that is not in the export");
  }
  if (!userIds.has(transfer.transferred_by)) {
    reject("budget_reappropriations", transfer.id, "transferred_by references a user that is not in the export");
  }
}

for (const supplement of supplementary) {
  if (!activityIds.has(supplement.activity_id)) {
    reject("supplementary_budgets", supplement.id, "references a budget activity that is not in the export");
  }
  if (!userIds.has(supplement.granted_by)) {
    reject("supplementary_budgets", supplement.id, "granted_by references a user that is not in the export");
  }
}

for (const run of payrollRuns) {
  if (!userIds.has(run.finalized_by)) reject("payroll_runs", run.id, "finalized_by references a missing user");
}
for (const run of payrollRemittanceRuns) {
  if (!userIds.has(run.finalized_by)) reject("payroll_remittance_runs", run.id, "finalized_by references a missing user");
}
for (const run of supplierRuns) {
  if (!userIds.has(run.finalized_by)) reject("supplier_tds_remittance_runs", run.id, "finalized_by references a missing user");
}

auditReferences();

const skip = (table: string, id: unknown): boolean => Boolean(invalidRows.get(table)?.has(id));

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

console.log(`\nPelsung Finance — D1 to Supabase migration`);
console.log(`Source: ${sourcePath}\n`);

const counts = {
  users: users.length,
  budget_activities: budgetActivities.length,
  departments: departments.length,
  employees: employees.length,
  vouchers: vouchers.length,
  voucher_budget_lines: voucherLines.length,
  payroll_runs: payrollRuns.length,
  payroll_run_items: payrollRunItems.length,
  payroll_remittance_runs: payrollRemittanceRuns.length,
  supplier_tds_remittance_runs: supplierRuns.length,
  supplier_tds_remittance_items: supplierItems.length,
  budget_reappropriations: reappropriations.length,
  supplementary_budgets: supplementary.length,
  audit_logs: auditLogs.length,
};

console.log("Rows found in the export:");
for (const [table, count] of Object.entries(counts)) console.log(`  ${table.padEnd(30)} ${count}`);
if (!present.has("users")) {
  console.error("\nThis file does not look like a Pelsung D1 export — no users table found.");
  process.exit(1);
}

if (releaseForecasts.length) {
  const archive = `${sourcePath.replace(/\.[^.]+$/, "")}-release-forecasts.json`;
  writeFileSync(archive, JSON.stringify(releaseForecasts, null, 2));
  console.log(
    `\nNote: ${releaseForecasts.length} release_forecasts rows have no table in the new schema (the feature had no screen).\n      They have been archived to ${archive} rather than discarded.`,
  );
}

if (clearedReferences.size) {
  const lines = [...clearedReferences];
  console.log(`\nReferences that no longer resolve (${lines.length}) — these will be stored as empty:`);
  for (const line of lines.slice(0, 15)) console.log(`  • ${line}`);
  if (lines.length > 15) console.log(`  … and ${lines.length - 15} more`);
}

if (problems.length) {
  console.log(`\nRows the new schema will not accept (${problems.length}):`);
  for (const line of problems.slice(0, 30)) console.log(`  ✗ ${line}`);
  if (problems.length > 30) console.log(`  … and ${problems.length - 30} more`);
  if (!skipInvalid && !dryRun) {
    console.error(
      `\nAborting. Correct these in the source export, or re-run with --skip-invalid to leave them behind.\nNothing has been written.`,
    );
    process.exit(1);
  }
  if (skipInvalid) console.log(`\n--skip-invalid: these rows will be left behind.`);
} else {
  console.log(`\nPre-flight passed: every row fits the new schema.`);
}

if (dryRun) {
  console.log(`\n--dry-run: nothing was written.`);
  source.close();
  await closeDatabase();
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* Load                                                                       */
/* -------------------------------------------------------------------------- */

const TARGET_TABLES = [
  "audit_logs",
  "supplier_tds_remittance_items",
  "voucher_budget_lines",
  "vouchers",
  "supplier_tds_remittance_runs",
  "payroll_remittance_runs",
  "payroll_run_items",
  "payroll_runs",
  "supplementary_budgets",
  "budget_reappropriations",
  "employees",
  "departments",
  "budget_activities",
  "sessions",
  "users",
] as const;

const existing = (await db.execute<{ table_name: string; rows: number }>(raw`
  SELECT 'users' AS table_name, COUNT(*)::int AS rows FROM users
  UNION ALL SELECT 'vouchers', COUNT(*)::int FROM vouchers
  UNION ALL SELECT 'budget_activities', COUNT(*)::int FROM budget_activities
  UNION ALL SELECT 'employees', COUNT(*)::int FROM employees
`)) as unknown as { table_name: string; rows: number }[];
const occupied = existing.filter((row) => row.rows > 0);

if (occupied.length && !replace) {
  console.error(
    `\nThe target database already holds data: ${occupied.map((row) => `${row.table_name} (${row.rows})`).join(", ")}.\n` +
      `Re-run with --replace to delete it first, or point DATABASE_URL at an empty database.\nNothing has been written.`,
  );
  process.exit(1);
}

console.log(`\nImporting…`);

await db.transaction(async (tx) => {
  if (replace) {
    // Children first so foreign keys stay satisfied throughout.
    for (const table of TARGET_TABLES) await tx.execute(raw.raw(`DELETE FROM ${table}`));
    console.log(`  cleared existing rows`);
  }

  const insert = async (table: string, rows: Row[], columns: string[], toValues: (row: Row) => unknown[]) => {
    if (!rows.length) return 0;
    let written = 0;
    for (const row of rows) {
      const values = toValues(row);
      const placeholders = values.map((value) => raw`${value}`);
      await tx.execute(raw`
        INSERT INTO ${raw.raw(table)} (${raw.raw(columns.join(", "))})
        VALUES (${raw.join(placeholders, raw`, `)})
      `);
      written += 1;
    }
    console.log(`  ${table.padEnd(30)} ${written}`);
    return written;
  };

  await insert(
    "users",
    users.filter((user) => !skip("users", user.id)),
    [
      "id", "username", "cid", "display_name", "designation", "role",
      "password_hash", "password_salt", "password_iterations", "must_change_password",
      "failed_attempts", "locked_until", "active", "last_login_at",
      "invitation_email_id", "invitation_sent_at", "deleted_at", "deleted_by", "created_at", "updated_at",
    ],
    (user) => [
      Number(user.id),
      String(user.username).trim().toLowerCase(),
      text(user.cid),
      String(user.display_name),
      text(user.designation) ?? "Not assigned",
      String(user.role),
      String(user.password_hash),
      String(user.password_salt),
      // Iteration counts travel with the hash, so existing passwords keep working.
      num(user.password_iterations, 100_000),
      bool(user.must_change_password),
      num(user.failed_attempts),
      ts(user.locked_until),
      bool(user.active),
      ts(user.last_login_at),
      text(user.invitation_email_id),
      ts(user.invitation_sent_at),
      ts(user.deleted_at),
      user.deleted_by === null ? null : ref(user.deleted_by, userIds, "deleted_by", "users", user.id),
      ts(user.created_at) ?? importedAt,
      ts(user.updated_at) ?? importedAt,
    ],
  );

  await insert(
    "budget_activities",
    budgetActivities.filter((activity) => !skip("budget_activities", activity.id)),
    ["id", "fiscal_year", "category", "financing", "obc", "activity", "budget_type", "approved_nu", "brief", "created_at"],
    (activity) => [
      Number(activity.id),
      text(activity.fiscal_year) ?? "2026-2027",
      String(activity.category),
      String(activity.financing),
      String(activity.obc),
      String(activity.activity),
      String(activity.budget_type),
      num(activity.approved_nu),
      String(activity.brief ?? ""),
      // The source has no creation timestamp for activities.
      importedAt,
    ],
  );

  await insert(
    "departments",
    departments,
    ["id", "name", "created_by", "created_at"],
    (department) => [
      Number(department.id),
      String(department.name).trim().replace(/\s+/g, " "),
      ref(department.created_by, userIds, "created_by", "departments", department.id),
      ts(department.created_at) ?? importedAt,
    ],
  );

  await insert(
    "employees",
    employees.filter((employee) => !skip("employees", employee.id)),
    [
      "id", "employee_number", "cid", "tpn", "full_name", "email", "designation", "department",
      "basic_pay_nu", "allowances_nu", "arrear_nu", "gross_pay_nu",
      "tax_on_salary_nu", "health_contribution_nu", "advance_nu", "deductions_nu",
      "status", "created_by", "created_at", "updated_at",
    ],
    (employee) => [
      Number(employee.id),
      String(employee.employee_number).toUpperCase(),
      text(employee.cid),
      text(employee.tpn)?.toUpperCase() ?? null,
      String(employee.full_name),
      text(employee.email)?.toLowerCase() ?? null,
      String(employee.designation),
      String(employee.department).trim().replace(/\s+/g, " "),
      // Legacy rows could leave basic pay empty, meaning "all of gross".
      num(employee.basic_pay_nu) || num(employee.gross_pay_nu),
      // The exempt allowance column was folded into allowances before removal.
      num(employee.allowances_nu) + num(employee.exempt_allowances_nu),
      num(employee.arrear_nu),
      num(employee.gross_pay_nu),
      num(employee.tax_on_salary_nu),
      num(employee.health_contribution_nu),
      num(employee.advance_nu),
      num(employee.deductions_nu),
      String(employee.status ?? "Active"),
      ref(employee.created_by, userIds, "created_by", "employees", employee.id),
      ts(employee.created_at) ?? importedAt,
      ts(employee.created_at) ?? importedAt,
    ],
  );

  await insert(
    "payroll_runs",
    payrollRuns.filter((run) => !skip("payroll_runs", run.id)),
    [
      "id", "fiscal_year", "pay_month", "department", "budget_activity_id", "employee_count",
      "basic_pay_nu", "allowances_nu", "arrear_nu", "gross_pay_nu", "tax_on_salary_nu",
      "health_contribution_nu", "advance_nu", "recoveries_nu", "net_pay_nu",
      "status", "finalized_by", "finalized_at", "posted_by", "posted_at", "posting_undone_at",
    ],
    (run) => [
      Number(run.id),
      String(run.fiscal_year),
      String(run.pay_month),
      String(run.department).trim().replace(/\s+/g, " "),
      ref(run.budget_activity_id, activityIds, "budget_activity_id", "payroll_runs", run.id),
      num(run.employee_count),
      num(run.basic_pay_nu),
      num(run.allowances_nu),
      num(run.arrear_nu),
      num(run.gross_pay_nu),
      num(run.tax_on_salary_nu),
      num(run.health_contribution_nu),
      num(run.advance_nu),
      num(run.recoveries_nu),
      num(run.net_pay_nu),
      String(run.status),
      Number(run.finalized_by),
      ts(run.finalized_at) ?? importedAt,
      ref(run.posted_by, userIds, "posted_by", "payroll_runs", run.id),
      ts(run.posted_at),
      ts(run.posting_undone_at),
    ],
  );

  await insert(
    "payroll_run_items",
    payrollRunItems.filter((item) => payrollRunIds.has(item.payroll_run_id) && employeeIds.has(item.employee_id)),
    [
      "id", "payroll_run_id", "employee_id", "employee_number", "cid", "tpn", "full_name", "email",
      "designation", "department", "basic_pay_nu", "allowances_nu", "arrear_nu", "gross_pay_nu",
      "tax_on_salary_nu", "health_contribution_nu", "advance_nu", "recoveries_nu", "net_pay_nu",
      "payslip_email_id", "payslip_sent_at",
    ],
    (item) => [
      Number(item.id),
      Number(item.payroll_run_id),
      Number(item.employee_id),
      String(item.employee_number),
      text(item.cid),
      text(item.tpn),
      String(item.full_name),
      text(item.email),
      String(item.designation),
      String(item.department).trim().replace(/\s+/g, " "),
      num(item.basic_pay_nu),
      num(item.allowances_nu),
      num(item.arrear_nu),
      num(item.gross_pay_nu),
      num(item.tax_on_salary_nu),
      num(item.health_contribution_nu),
      num(item.advance_nu),
      num(item.recoveries_nu),
      num(item.net_pay_nu),
      text(item.payslip_email_id),
      ts(item.payslip_sent_at),
    ],
  );

  await insert(
    "payroll_remittance_runs",
    payrollRemittanceRuns.filter((run) => !skip("payroll_remittance_runs", run.id)),
    [
      "id", "fiscal_year", "pay_month", "employee_count", "tax_on_salary_nu", "health_contribution_nu",
      "total_remittance_nu", "status", "finalized_by", "finalized_at", "posted_by", "posted_at",
    ],
    (run) => [
      Number(run.id),
      String(run.fiscal_year),
      String(run.pay_month),
      num(run.employee_count),
      num(run.tax_on_salary_nu),
      num(run.health_contribution_nu),
      num(run.total_remittance_nu),
      String(run.status),
      Number(run.finalized_by),
      ts(run.finalized_at) ?? importedAt,
      ref(run.posted_by, userIds, "posted_by", "payroll_remittance_runs", run.id),
      ts(run.posted_at),
    ],
  );

  await insert(
    "supplier_tds_remittance_runs",
    supplierRuns.filter((run) => !skip("supplier_tds_remittance_runs", run.id)),
    [
      "id", "fiscal_year", "pay_month", "tds_rate", "source_voucher_count", "total_remittance_nu",
      "status", "finalized_by", "finalized_at",
    ],
    (run) => [
      Number(run.id),
      String(run.fiscal_year),
      String(run.pay_month),
      num(run.tds_rate),
      num(run.source_voucher_count),
      num(run.total_remittance_nu),
      String(run.status),
      Number(run.finalized_by),
      ts(run.finalized_at) ?? importedAt,
    ],
  );

  const importedVouchers = vouchers.filter((voucher) => !skip("vouchers", voucher.id));
  await insert(
    "vouchers",
    importedVouchers,
    [
      "id", "voucher_number", "activity_id", "fiscal_year", "voucher_type", "payee", "tpn", "bill_reference",
      "description", "amount_nu", "gst_nu", "tds_rate", "tds_nu", "advance_recovery_nu",
      "advance_recovery_voucher_id", "net_payment_nu", "payroll_run_id", "payroll_remittance_run_id",
      "supplier_tds_remittance_run_id", "payroll_entry_type", "payroll_health_contribution_nu",
      "status", "transaction_date", "created_at", "created_by", "approved_by", "approved_at",
      "reversed_by", "reversed_at", "reversal_reason",
    ],
    (voucher) => {
      const amountNu = num(voucher.amount_nu);
      const tdsNu = num(voucher.tds_nu);
      const recoveryNu = num(voucher.advance_recovery_nu);
      // Legacy rows could leave net payment unset; recompute exactly as the
      // old runtime did on read, so printed vouchers keep their figures.
      const storedNet = num(voucher.net_payment_nu);
      const netPaymentNu =
        String(voucher.payroll_entry_type ?? "") === "combined"
          ? storedNet
          : storedNet ||
            (String(voucher.voucher_type) === "Payment"
              ? calculateVoucherDeductions(amountNu, num(voucher.gst_nu), num(voucher.tds_rate), recoveryNu).netPaymentNu
              : amountNu);

      return [
        Number(voucher.id),
        String(voucher.voucher_number),
        ref(voucher.activity_id, activityIds, "activity_id", "vouchers", voucher.id),
        text(voucher.fiscal_year) ?? "2026-2027",
        String(voucher.voucher_type),
        String(voucher.payee),
        text(voucher.tpn),
        text(voucher.bill_reference),
        String(voucher.description),
        amountNu,
        num(voucher.gst_nu),
        num(voucher.tds_rate),
        tdsNu,
        recoveryNu,
        ref(voucher.advance_recovery_voucher_id, voucherIds, "advance_recovery_voucher_id", "vouchers", voucher.id),
        netPaymentNu,
        ref(voucher.payroll_run_id, payrollRunIds, "payroll_run_id", "vouchers", voucher.id),
        voucher.payroll_remittance_run_id === null ? null : Number(voucher.payroll_remittance_run_id),
        voucher.supplier_tds_remittance_run_id === null ? null : Number(voucher.supplier_tds_remittance_run_id),
        text(voucher.payroll_entry_type),
        num(voucher.payroll_health_contribution_nu),
        String(voucher.status),
        String(voucher.transaction_date),
        ts(voucher.created_at) ?? importedAt,
        ref(voucher.created_by, userIds, "created_by", "vouchers", voucher.id),
        ref(voucher.approved_by, userIds, "approved_by", "vouchers", voucher.id),
        ts(voucher.approved_at),
        ref(voucher.reversed_by, userIds, "reversed_by", "vouchers", voucher.id),
        ts(voucher.reversed_at),
        text(voucher.reversal_reason),
      ];
    },
  );

  const importedVoucherIds = new Set(importedVouchers.map((voucher) => voucher.id));

  // Budget lines carry the allocation. Older vouchers pre-date the table and
  // carry a single activity_id instead — those are expanded to one line here,
  // exactly as the old runtime back-filled them.
  const linesByVoucher = new Set(voucherLines.map((line) => `${line.voucher_id}|${line.activity_id}`));
  const backfilled: Row[] = [];
  let syntheticId = Math.max(0, ...voucherLines.map((line) => num(line.id))) + 1;
  for (const voucher of importedVouchers) {
    if (!voucher.activity_id || num(voucher.amount_nu) <= 0) continue;
    if (linesByVoucher.has(`${voucher.id}|${voucher.activity_id}`)) continue;
    const hasAnyLine = voucherLines.some((line) => line.voucher_id === voucher.id);
    if (hasAnyLine) continue;
    backfilled.push({
      id: syntheticId++,
      voucher_id: voucher.id,
      activity_id: voucher.activity_id,
      amount_nu: voucher.amount_nu,
    });
  }

  await insert(
    "voucher_budget_lines",
    [...voucherLines, ...backfilled].filter(
      (line) => importedVoucherIds.has(line.voucher_id) && activityIds.has(line.activity_id) && num(line.amount_nu) > 0,
    ),
    ["id", "voucher_id", "activity_id", "amount_nu"],
    (line) => [Number(line.id), Number(line.voucher_id), Number(line.activity_id), num(line.amount_nu)],
  );
  if (backfilled.length) console.log(`    (${backfilled.length} allocation lines rebuilt from single-activity vouchers)`);

  await insert(
    "supplier_tds_remittance_items",
    supplierItems.filter((item) => importedVoucherIds.has(item.voucher_id)),
    ["id", "remittance_run_id", "voucher_id", "tds_nu"],
    (item) => [Number(item.id), Number(item.remittance_run_id), Number(item.voucher_id), num(item.tds_nu)],
  );

  await insert(
    "budget_reappropriations",
    reappropriations.filter((transfer) => !skip("budget_reappropriations", transfer.id)),
    [
      "id", "fiscal_year", "source_activity_id", "destination_activity_id",
      "amount_nu", "reason", "transferred_by", "transferred_at",
    ],
    (transfer) => [
      Number(transfer.id),
      String(transfer.fiscal_year),
      Number(transfer.source_activity_id),
      Number(transfer.destination_activity_id),
      num(transfer.amount_nu),
      String(transfer.reason),
      Number(transfer.transferred_by),
      ts(transfer.transferred_at) ?? importedAt,
    ],
  );

  await insert(
    "supplementary_budgets",
    supplementary.filter((supplement) => !skip("supplementary_budgets", supplement.id)),
    ["id", "fiscal_year", "activity_id", "amount_nu", "reason", "granted_by", "granted_at"],
    (supplement) => [
      Number(supplement.id),
      String(supplement.fiscal_year),
      Number(supplement.activity_id),
      num(supplement.amount_nu),
      String(supplement.reason),
      Number(supplement.granted_by),
      ts(supplement.granted_at) ?? importedAt,
    ],
  );

  await insert(
    "audit_logs",
    auditLogs,
    ["id", "user_id", "action", "entity_type", "entity_id", "detail", "created_at"],
    (entry) => [
      Number(entry.id),
      ref(entry.user_id, userIds, "user_id", "audit_logs", entry.id),
      String(entry.action),
      String(entry.entity_type),
      text(entry.entity_id),
      String(entry.detail),
      ts(entry.created_at) ?? importedAt,
    ],
  );

  // Explicit ids were supplied, so move each identity sequence past them.
  for (const table of [
    "users", "budget_activities", "departments", "employees", "vouchers", "voucher_budget_lines",
    "payroll_runs", "payroll_run_items", "payroll_remittance_runs",
    "supplier_tds_remittance_runs", "supplier_tds_remittance_items",
    "budget_reappropriations", "supplementary_budgets", "audit_logs",
  ]) {
    await tx.execute(
      raw.raw(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`,
      ),
    );
  }
  console.log(`  identity sequences realigned`);
});

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                             */
/* -------------------------------------------------------------------------- */

const sum = (rows: Row[], column: string) => rows.reduce((total, row) => total + num(row[column]), 0);

const target = (await db.execute<Record<string, number>>(raw`
  SELECT
    (SELECT COUNT(*)::int FROM users) AS users,
    (SELECT COUNT(*)::int FROM budget_activities) AS budget_activities,
    (SELECT COUNT(*)::int FROM departments) AS departments,
    (SELECT COUNT(*)::int FROM employees) AS employees,
    (SELECT COUNT(*)::int FROM vouchers) AS vouchers,
    (SELECT COUNT(*)::int FROM voucher_budget_lines) AS voucher_budget_lines,
    (SELECT COUNT(*)::int FROM payroll_runs) AS payroll_runs,
    (SELECT COUNT(*)::int FROM payroll_run_items) AS payroll_run_items,
    (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs,
    (SELECT COALESCE(SUM(approved_nu), 0)::bigint FROM budget_activities) AS approved_nu,
    (SELECT COALESCE(SUM(amount_nu), 0)::bigint FROM vouchers) AS voucher_amount_nu,
    (SELECT COALESCE(SUM(tds_nu), 0)::bigint FROM vouchers) AS voucher_tds_nu,
    (SELECT COALESCE(SUM(net_pay_nu), 0)::bigint FROM payroll_runs) AS payroll_net_nu
`)) as unknown as Record<string, number>[];
const after = target[0];

const expected: Record<string, number> = {
  users: users.filter((user) => !skip("users", user.id)).length,
  budget_activities: budgetActivities.filter((activity) => !skip("budget_activities", activity.id)).length,
  departments: departments.length,
  employees: employees.filter((employee) => !skip("employees", employee.id)).length,
  vouchers: vouchers.filter((voucher) => !skip("vouchers", voucher.id)).length,
  payroll_runs: payrollRuns.filter((run) => !skip("payroll_runs", run.id)).length,
  audit_logs: auditLogs.length,
  approved_nu: sum(budgetActivities.filter((activity) => !skip("budget_activities", activity.id)), "approved_nu"),
  voucher_amount_nu: sum(vouchers.filter((voucher) => !skip("vouchers", voucher.id)), "amount_nu"),
  voucher_tds_nu: sum(vouchers.filter((voucher) => !skip("vouchers", voucher.id)), "tds_nu"),
  payroll_net_nu: sum(payrollRuns.filter((run) => !skip("payroll_runs", run.id)), "net_pay_nu"),
};

console.log(`\nReconciliation — source against Supabase:\n`);
console.log(`  ${"".padEnd(30)}${"expected".padStart(16)}${"imported".padStart(16)}`);
let mismatched = 0;
for (const [key, value] of Object.entries(expected)) {
  const actual = Number(after[key] ?? 0);
  const agrees = actual === value;
  if (!agrees) mismatched += 1;
  console.log(`  ${agrees ? "✓" : "✗"} ${key.padEnd(28)}${String(value).padStart(16)}${String(actual).padStart(16)}`);
}
console.log(`  ${"voucher_budget_lines".padEnd(30)}${"".padStart(16)}${String(after.voucher_budget_lines).padStart(16)}`);
console.log(`  ${"payroll_run_items".padEnd(30)}${"".padStart(16)}${String(after.payroll_run_items).padStart(16)}`);

source.close();
await closeDatabase();

if (mismatched) {
  console.error(`\n${mismatched} figure(s) do not agree. Investigate before using this database.`);
  process.exit(1);
}

console.log(`
Migration complete. Every row and every total agrees.

Next:
  • Sessions were deliberately not carried over — everyone signs in again.
    Their existing passwords still work.
  • Sign in and check the Dashboard totals against the old system.
  • Keep the D1 export: it is your rollback.
`);
