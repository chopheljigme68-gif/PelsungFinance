import { sql as raw } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { closeDatabase, db } from "./client.js";

/**
 * Washes transactional data for a fresh start, KEEPING setup:
 * user accounts, budget activities, departments and the TPN registry stay.
 *
 * Cleared: vouchers (+ budget lines, supplier-TDS remittances), employees and
 * all payroll (runs, items, remittances), and bank reconciliations + month
 * closures. Budget committed/utilized figures are derived from vouchers, so they
 * return to zero automatically once the vouchers are gone.
 *
 * DESTRUCTIVE and irreversible — run only against a database you intend to reset.
 * Guarded: it aborts unless you pass `--yes` (or set CONFIRM_WASH=yes).
 *
 *   npm run db:wash -- --yes
 */
const TABLES = [
  "supplier_tds_remittance_items",
  "voucher_budget_lines",
  "vouchers",
  "supplier_tds_remittance_runs",
  "payroll_remittance_runs",
  "payroll_run_items",
  "payroll_runs",
  "employees",
  "bank_reconciliation_items",
  "bank_reconciliations",
  "month_closures",
] as const;

const KEPT = ["users", "budget_activities", "budget_reappropriations", "supplementary_budgets", "departments", "tpn_registrations", "audit_logs"];

function confirmed(): boolean {
  const flag = process.argv.slice(2).some((arg) => arg === "--yes" || arg === "-y");
  const env = ["yes", "y", "1", "true"].includes((process.env.CONFIRM_WASH ?? "").toLowerCase());
  return flag || env;
}

async function counts(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = (await db.execute(raw.raw(`SELECT COUNT(*)::int AS count FROM ${table}`))) as unknown as {
      count: number;
    }[];
    result[table] = Number(row?.count ?? 0);
  }
  return result;
}

async function main(): Promise<void> {
  if (!confirmed()) {
    logger.warn(
      { willClear: TABLES, willKeep: KEPT },
      "db:wash is DESTRUCTIVE and did nothing. Re-run with `-- --yes` (or CONFIRM_WASH=yes) to clear transactional data.",
    );
    return;
  }

  const before = await counts();
  logger.info({ before }, "Washing transactional data…");

  // One statement, order-independent: TRUNCATE with CASCADE + identity reset.
  await db.execute(raw.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));

  const after = await counts();
  logger.info({ cleared: before, remaining: after, kept: KEPT }, "Data wash complete. Setup data (users, budget, departments, TPN) preserved.");
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, "Data wash failed");
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
