import { and, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Response } from "express";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { passwordResetTokens, sessions, users } from "../../db/schema.js";
import { rolePermissions, roleLabels, type AppRole, type Permission } from "../../domain/permissions.js";
import { audit } from "../../lib/audit.js";
import { sendPasswordResetEmail } from "../../lib/email.js";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import {
  createPasswordRecord,
  generateSessionToken,
  hashPassword,
  passwordPolicy,
  sha256Hex,
  timingSafeEqual,
  validatePassword,
} from "../../lib/password.js";

export const SESSION_COOKIE = "pelsung_session";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_LINK_MINUTES = 30;
/** A second request inside this window reuses nothing and sends nothing, so the form can't be used to flood an inbox. */
const RESET_RESEND_SECONDS = 60;

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  designation: string;
  role: AppRole;
  mustChangePassword: boolean;
};

export type PublicUser = SessionUser & {
  roleLabel: string;
  permissions: Permission[];
};

export function publicUser(user: SessionUser): PublicUser {
  return { ...user, roleLabel: roleLabels[user.role], permissions: rolePermissions[user.role] };
}

export function can(user: SessionUser, permission: Permission): boolean {
  return rolePermissions[user.role].includes(permission);
}

export function assertPermission(user: SessionUser, permission: Permission): void {
  if (!can(user, permission)) throw forbidden();
}

export { passwordPolicy };

/* -------------------------------------------------------------------------- */
/* Session cookie                                                             */
/* -------------------------------------------------------------------------- */

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  } as const;
}

export function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export async function createSession(userId: number) {
  const token = generateSessionToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + env.sessionTtlSeconds * 1000);

  // Opportunistically sweep expired sessions on every sign-in.
  await db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
  await db.insert(sessions).values({ tokenHash, userId, expiresAt });

  return { token, tokenHash, maxAge: env.sessionTtlSeconds };
}

export async function resolveSession(token: string | undefined): Promise<{ user: SessionUser; tokenHash: string } | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      designation: users.designation,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()), eq(users.active, true)))
    .limit(1);

  if (!row) return null;
  return { user: { ...row, role: row.role as AppRole }, tokenHash };
}

export async function destroySession(tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function destroyUserSessions(userId: number, exceptTokenHash?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(
      exceptTokenHash
        ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, exceptTokenHash))
        : eq(sessions.userId, userId),
    );
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                    */
/* -------------------------------------------------------------------------- */

const GENERIC_SIGN_IN_ERROR = "The username or password is incorrect.";

export async function login(rawUsername: string, password: string): Promise<SessionUser> {
  const username = rawUsername.trim().toLocaleLowerCase().normalize("NFC");

  const [record] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      designation: users.designation,
      role: users.role,
      passwordHash: users.passwordHash,
      passwordSalt: users.passwordSalt,
      passwordIterations: users.passwordIterations,
      mustChangePassword: users.mustChangePassword,
      failedAttempts: users.failedAttempts,
      lockedUntil: users.lockedUntil,
      active: users.active,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!record || !record.active) throw unauthorized(GENERIC_SIGN_IN_ERROR);

  if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
    throw tooManyRequests(`Too many unsuccessful attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
  }

  const candidateHash = await hashPassword(password, record.passwordSalt, record.passwordIterations);
  if (!timingSafeEqual(candidateHash, record.passwordHash)) {
    const attempts = record.failedAttempts + 1;
    const locked = attempts >= MAX_FAILED_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedAttempts: locked ? 0 : attempts,
        lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, record.id));
    await audit(record.id, "login_failed", "user", record.id, "Unsuccessful password attempt");
    if (locked) throw tooManyRequests(`Too many unsuccessful attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
    throw unauthorized(GENERIC_SIGN_IN_ERROR);
  }

  await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, record.id));
  await audit(record.id, "login_succeeded", "user", record.id, "Successful sign-in");

  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    designation: record.designation,
    role: record.role as AppRole,
    mustChangePassword: record.mustChangePassword,
  };
}

/* -------------------------------------------------------------------------- */
/* Password change                                                            */
/* -------------------------------------------------------------------------- */

export async function changePassword(
  user: SessionUser,
  input: { currentPassword: string; newPassword: string; confirmPassword: string },
  activeSessionHash?: string,
): Promise<SessionUser> {
  if (input.newPassword !== input.confirmPassword) throw conflict("The new passwords do not match.");

  const policyError = validatePassword(input.newPassword);
  if (policyError) throw conflict(policyError);

  const [current] = await db
    .select({
      passwordHash: users.passwordHash,
      passwordSalt: users.passwordSalt,
      passwordIterations: users.passwordIterations,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!current) throw unauthorized();

  const currentHash = await hashPassword(input.currentPassword, current.passwordSalt, current.passwordIterations);
  if (!timingSafeEqual(currentHash, current.passwordHash)) throw unauthorized("The current password is incorrect.");

  const reusedHash = await hashPassword(input.currentPassword, current.passwordSalt, current.passwordIterations);
  const candidateNewHash = await hashPassword(input.newPassword, current.passwordSalt, current.passwordIterations);
  if (timingSafeEqual(candidateNewHash, reusedHash)) {
    throw conflict("Choose a password different from the current password.");
  }

  const replacement = await createPasswordRecord(input.newPassword);
  await db
    .update(users)
    .set({
      passwordHash: replacement.hash,
      passwordSalt: replacement.salt,
      passwordIterations: replacement.iterations,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await destroyUserSessions(user.id, activeSessionHash);
  await audit(user.id, "password_changed", "user", user.id, "Password changed and other sessions revoked");

  return { ...user, mustChangePassword: false };
}

/** Count of admins who can still administer the system. */
export async function activeAdminCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "agency_admin"), eq(users.active, true), sql`${users.deletedAt} is null`));
  return row?.count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Forgot password                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Emails a single-use reset link when the address belongs to an active user.
 *
 * Runs after the HTTP response (see the route), so callers learn nothing about
 * which addresses are registered.
 */
export async function requestPasswordReset(rawUsername: string, resetPageUrl: string): Promise<void> {
  const username = rawUsername.trim().toLocaleLowerCase().normalize("NFC");

  const [user] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.username, username), eq(users.active, true), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return;

  const now = new Date();
  await db
    .delete(passwordResetTokens)
    .where(or(lte(passwordResetTokens.expiresAt, now), sql`${passwordResetTokens.usedAt} is not null`));

  const [recent] = await db
    .select({ createdAt: passwordResetTokens.createdAt })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        gt(passwordResetTokens.createdAt, new Date(now.getTime() - RESET_RESEND_SECONDS * 1000)),
      ),
    )
    .limit(1);
  if (recent) return;

  // Only the newest link works: requesting again invalidates any earlier one.
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

  const token = generateSessionToken();
  await db.insert(passwordResetTokens).values({
    tokenHash: sha256Hex(token),
    userId: user.id,
    expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60 * 1000),
  });
  await audit(user.id, "password_reset_requested", "user", user.id, "Password reset link requested");

  const resetUrl = `${resetPageUrl}?token=${encodeURIComponent(token)}`;
  try {
    await sendPasswordResetEmail({
      recipient: user.username,
      displayName: user.displayName,
      resetUrl,
      expiresInMinutes: RESET_LINK_MINUTES,
    });
  } catch (error) {
    logger.error({ err: error, userId: user.id }, "Password reset email could not be delivered");
  }
}

const INVALID_RESET_LINK = "This reset link is invalid or has expired. Request a new one from the sign-in page.";

/** Sets a new password from a reset link, then signs the account out everywhere. */
export async function resetPassword(input: { token: string; newPassword: string; confirmPassword: string }): Promise<void> {
  if (input.newPassword !== input.confirmPassword) throw conflict("The new passwords do not match.");
  const policyError = validatePassword(input.newPassword);
  if (policyError) throw conflict(policyError);

  const tokenHash = sha256Hex(input.token);
  const replacement = await createPasswordRecord(input.newPassword);

  const userId = await db.transaction(async (tx) => {
    // Claiming the token in one UPDATE makes it single-use even under a double submit.
    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });
    if (!claimed) throw badRequest(INVALID_RESET_LINK);

    const [updated] = await tx
      .update(users)
      .set({
        passwordHash: replacement.hash,
        passwordSalt: replacement.salt,
        passwordIterations: replacement.iterations,
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, claimed.userId), eq(users.active, true), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!updated) throw badRequest(INVALID_RESET_LINK);

    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, updated.id));
    await tx.delete(sessions).where(eq(sessions.userId, updated.id));
    return updated.id;
  });

  await audit(userId, "password_reset", "user", userId, "Password reset by email link; all sessions revoked");
}
