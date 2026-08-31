import { eq } from "drizzle-orm";
import { validatePassword, createPasswordRecord } from "../lib/password.js";
import { closeDatabase, db } from "./client.js";
import { sessions, users } from "./schema.js";

/**
 * Sets a user's password directly, without email.
 *
 * Invitations carry the temporary password in the email itself, so when
 * delivery fails — an unverified Resend domain, no API key, an offline
 * provider — the new account cannot be reached at all. This is the way back
 * in: an operator with database access sets a known password.
 *
 *   npm run set-password -- <email> "<NewPassword@1>"
 *
 * The account's other sessions are revoked, exactly as a self-service change
 * does, and `must_change_password` is cleared so the password stands as given.
 */
async function main(): Promise<void> {
  const [rawUsername, password] = process.argv.slice(2);

  if (!rawUsername || !password) {
    console.error('Usage: npm run set-password -- <email> "<NewPassword@1>"');
    process.exitCode = 1;
    return;
  }

  const username = rawUsername.trim().toLocaleLowerCase().normalize("NFC");

  const policyError = validatePassword(password);
  if (policyError) {
    console.error(`That password is not allowed: ${policyError}`);
    process.exitCode = 1;
    return;
  }

  const [target] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!target) {
    console.error(`No user has the email ${username}.`);
    process.exitCode = 1;
    return;
  }
  if (!target.active || target.deletedAt) {
    console.error(`${target.displayName} is deleted or inactive — restore the account before setting a password.`);
    process.exitCode = 1;
    return;
  }

  const record = await createPasswordRecord(password);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash: record.hash,
        passwordSalt: record.salt,
        passwordIterations: record.iterations,
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id));

    // A password change invalidates every existing session for that account.
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
  });

  console.log(`Password set for ${target.displayName} <${username}> (${target.role}).`);
  console.log("Any existing sessions for that account were signed out.");
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (error) => {
    console.error("Setting the password failed:", error instanceof Error ? error.message : error);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });