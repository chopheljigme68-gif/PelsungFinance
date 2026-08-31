import { sql as raw } from "drizzle-orm";
import { env } from "../config/env.js";
import { DEFAULT_FISCAL_YEAR } from "../domain/fiscal-year.js";
import { logger } from "../lib/logger.js";
import { createPasswordRecord, validatePassword } from "../lib/password.js";
import { budgetSeeds } from "./budget-seed-data.js";
import { closeDatabase, db } from "./client.js";
import { budgetActivities, users } from "./schema.js";

/**
 * Idempotent first-run setup.
 *
 * - Creates the bootstrap administrator only when the users table is empty.
 *   The account starts with `must_change_password`, so the operator replaces
 *   the seeded password at first sign-in.
 * - Loads the approved FY 2026-2027 budget only when no activities exist.
 *
 * Running it again on a populated database changes nothing.
 */
async function seedBootstrapAdmin(): Promise<void> {
  const [existing] = await db.execute<{ count: number }>(raw`SELECT COUNT(*)::int AS "count" FROM users`) as unknown as {
    count: number;
  }[];
  if ((existing?.count ?? 0) > 0) {
    logger.info("Users already exist — bootstrap administrator not created.");
    return;
  }

  const password = env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!password) {
    logger.warn("BOOTSTRAP_ADMIN_PASSWORD is not set — no administrator was created. Set it in .env and re-run `npm run db:seed`.");
    return;
  }

  const policyError = validatePassword(password);
  if (policyError) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD is invalid: ${policyError}`);

  const cid = env.BOOTSTRAP_ADMIN_CID?.trim();
  const record = await createPasswordRecord(password);

  await db.insert(users).values({
    username: env.BOOTSTRAP_ADMIN_EMAIL.trim().toLocaleLowerCase().normalize("NFC"),
    cid: cid && /^\d{11}$/.test(cid) ? cid : null,
    displayName: env.BOOTSTRAP_ADMIN_NAME.trim(),
    designation: env.BOOTSTRAP_ADMIN_DESIGNATION.trim(),
    role: "agency_admin",
    passwordHash: record.hash,
    passwordSalt: record.salt,
    passwordIterations: record.iterations,
    mustChangePassword: true,
  });

  logger.info(
    { username: env.BOOTSTRAP_ADMIN_EMAIL },
    "Bootstrap administrator created. Sign in and change the password immediately.",
  );
}

async function seedBudgetActivities(): Promise<void> {
  if (!env.SEED_BUDGET_ACTIVITIES) {
    logger.info("SEED_BUDGET_ACTIVITIES is off — approved budget not loaded.");
    return;
  }

  const [existing] = await db.execute<{ count: number }>(
    raw`SELECT COUNT(*)::int AS "count" FROM budget_activities`,
  ) as unknown as { count: number }[];
  if ((existing?.count ?? 0) > 0) {
    logger.info("Budget activities already exist — approved budget not re-seeded.");
    return;
  }

  await db.insert(budgetActivities).values(
    budgetSeeds.map((seed) => ({
      id: seed.id,
      fiscalYear: DEFAULT_FISCAL_YEAR,
      category: seed.category,
      financing: seed.financing,
      obc: seed.obc,
      activity: seed.activity,
      budgetType: seed.budgetType,
      approvedNu: seed.approvedNu,
      brief: seed.brief,
    })),
  );

  // Explicit ids were supplied, so realign the identity sequence.
  await db.execute(
    raw`SELECT setval(pg_get_serial_sequence('budget_activities', 'id'), COALESCE((SELECT MAX(id) FROM budget_activities), 1))`,
  );

  logger.info({ activities: budgetSeeds.length, fiscalYear: DEFAULT_FISCAL_YEAR }, "Approved budget loaded.");
}

async function main(): Promise<void> {
  await seedBootstrapAdmin();
  await seedBudgetActivities();
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, "Seeding failed");
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
