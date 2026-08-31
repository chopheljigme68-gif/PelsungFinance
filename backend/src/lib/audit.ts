import { db, type DbExecutor } from "../db/client.js";
import { auditLogs } from "../db/schema.js";
import { logger } from "./logger.js";

/**
 * Appends to the immutable audit trail.
 *
 * Pass the transaction handle when the entry must be rolled back with its
 * operation; omit it for post-commit notes (email delivery, sign-in events).
 * Auditing never fails a request — a failure here is logged, not thrown.
 */
export async function audit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  detail: string,
  executor: DbExecutor = db,
): Promise<void> {
  try {
    await executor.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId: entityId === null ? null : String(entityId),
      detail,
    });
  } catch (error) {
    logger.error({ err: error, action, entityType, entityId }, "Audit entry could not be written");
  }
}
