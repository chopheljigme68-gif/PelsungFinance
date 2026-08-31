import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, db } from "./client.js";
import { logger } from "../lib/logger.js";

/**
 * Applies every pending SQL migration in ./drizzle.
 *
 * Run this before the API starts on a new environment:
 *   npm run db:migrate
 */
async function main(): Promise<void> {
  logger.info("Applying database migrations…");
  await migrate(db, { migrationsFolder: "drizzle" });
  logger.info("Migrations applied.");
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.fatal({ err: error }, "Migration failed");
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
