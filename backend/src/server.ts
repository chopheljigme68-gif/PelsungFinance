import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabase, closeDatabase } from "./db/client.js";
import { logger } from "./lib/logger.js";

const app = createApp();

const server = app.listen(env.PORT, async () => {
  const database = await checkDatabase();
  logger.info(
    {
      port: env.PORT,
      environment: env.NODE_ENV,
      database: database ? "connected" : "unavailable",
      email: env.emailEnabled ? "enabled" : "disabled",
      corsOrigins: env.corsOrigins,
    },
    "Pelsung Finance API started",
  );
  if (!database) {
    logger.warn("The database is not reachable. Check DATABASE_URL and run `npm run db:setup`.");
  }
});

/** Finish in-flight requests, then release the pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Unhandled promise rejection"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});
