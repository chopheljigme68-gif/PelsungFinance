import { and, eq, ne, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { roleLabels, type AppRole } from "../../domain/permissions.js";
import { audit } from "../../lib/audit.js";
import { EmailDeliveryError, sendInvitationEmail } from "../../lib/email.js";
import { PG_UNIQUE_VIOLATION, conflict, isPostgresError, notFound, serverError } from "../../lib/errors.js";
import { createPasswordRecord, generateTemporaryPassword, validatePassword } from "../../lib/password.js";
import { activeAdminCount, destroyUserSessions, type SessionUser } from "../auth/auth.service.js";

export type CreateUserInput = {
  username: string;
  cid: string;
  displayName: string;
  designation: string;
  role: AppRole;
};

/**
 * Creates a user with a generated temporary password and emails the invitation.
 *
 * The account is created first: if the mail provider is unavailable the user
 * still exists with "Invitation pending" and an admin can retry delivery,
 * rather than losing the record to an email failure.
 */
export async function createUser(
  actor: SessionUser,
  input: CreateUserInput,
  loginUrl: string,
): Promise<{ actionNotice: string | null }> {
  const username = input.username.trim().toLocaleLowerCase().normalize("NFC");
  const cid = input.cid.trim();

  const [duplicate] = await db
    .select({ username: users.username, cid: users.cid })
    .from(users)
    .where(or(eq(users.username, username), eq(users.cid, cid)))
    .limit(1);
  if (duplicate) {
    throw conflict(`That ${duplicate.username === username ? "email user ID" : "CID"} is already registered.`);
  }

  const temporaryPassword = generateTemporaryPassword();
  if (validatePassword(temporaryPassword)) {
    throw serverError("A secure temporary password could not be generated. Please try again.");
  }
  const password = await createPasswordRecord(temporaryPassword);

  let createdUserId: number;
  try {
    const [created] = await db
      .insert(users)
      .values({
        username,
        cid,
        displayName: input.displayName.trim(),
        designation: input.designation.trim(),
        role: input.role,
        passwordHash: password.hash,
        passwordSalt: password.salt,
        passwordIterations: password.iterations,
        mustChangePassword: true,
      })
      .returning({ id: users.id });
    createdUserId = created.id;
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION)) {
      throw conflict("That email user ID or CID is already registered.");
    }
    throw error;
  }

  try {
    const emailId = await sendInvitationEmail({
      recipient: username,
      displayName: input.displayName,
      temporaryPassword,
      loginUrl,
    });
    const sentAt = new Date();
    await db
      .update(users)
      .set({ invitationEmailId: emailId, invitationSentAt: sentAt, updatedAt: sentAt })
      .where(eq(users.id, createdUserId));
    await audit(
      actor.id,
      "user_created",
      "user",
      createdUserId,
      `${input.displayName}, ${input.designation}, assigned ${roleLabels[input.role]}; invitation emailed`,
    );
    return { actionNotice: null };
  } catch (error) {
    const message =
      error instanceof EmailDeliveryError
        ? error.message
        : "The email provider could not deliver the invitation. Check the verified sender and retry from User Management.";
    await audit(
      actor.id,
      "user_created_invitation_pending",
      "user",
      createdUserId,
      `${input.displayName}, ${input.designation}, assigned ${roleLabels[input.role]}; invitation pending`,
    );
    return { actionNotice: `${input.displayName} was created with Invitation pending. ${message}` };
  }
}

/** Issues a fresh temporary password and retries the invitation email. */
export async function resendInvitation(
  actor: SessionUser,
  targetUserId: number,
  loginUrl: string,
): Promise<{ actionNotice: string }> {
  const [target] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!target) throw notFound("The selected user was not found.");
  if (!target.active || target.deletedAt) {
    throw conflict("An invitation cannot be sent to a deleted or inactive user.");
  }

  const temporaryPassword = generateTemporaryPassword();
  if (validatePassword(temporaryPassword)) {
    throw serverError("A secure temporary password could not be generated. Please try again.");
  }
  const password = await createPasswordRecord(temporaryPassword);

  await db
    .update(users)
    .set({
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordIterations: password.iterations,
      mustChangePassword: true,
      invitationEmailId: null,
      invitationSentAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetUserId));

  try {
    const emailId = await sendInvitationEmail({
      recipient: target.username,
      displayName: target.displayName,
      temporaryPassword,
      loginUrl,
    });
    const sentAt = new Date();
    await db
      .update(users)
      .set({ invitationEmailId: emailId, invitationSentAt: sentAt, updatedAt: sentAt })
      .where(eq(users.id, targetUserId));
    await audit(actor.id, "user_invitation_resent", "user", targetUserId, `${target.displayName}; invitation emailed`);
    return {
      actionNotice: `A new temporary password was emailed to ${target.username}. The previous password is no longer valid.`,
    };
  } catch (error) {
    const message =
      error instanceof EmailDeliveryError
        ? error.message
        : "The email provider could not deliver the invitation. Check the verified sender and retry from User Management.";
    await audit(
      actor.id,
      "user_invitation_pending",
      "user",
      targetUserId,
      `${target.displayName}; invitation delivery pending`,
    );
    return { actionNotice: `The invitation for ${target.displayName} is still pending. ${message}` };
  }
}

export type UpdateUserInput = CreateUserInput;

export async function updateUser(actor: SessionUser, targetUserId: number, input: UpdateUserInput): Promise<void> {
  const username = input.username.trim().toLocaleLowerCase().normalize("NFC");
  const cid = input.cid.trim();

  const [target] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!target) throw notFound("The selected user was not found.");
  if (!target.active || target.deletedAt) throw conflict("A deleted or inactive user cannot be edited.");
  if (targetUserId === actor.id && input.role !== actor.role) {
    throw conflict("An administrator cannot change their own role.");
  }
  if (target.role === "agency_admin" && input.role !== "agency_admin" && (await activeAdminCount()) <= 1) {
    throw conflict("The last active Admin must retain the Admin role.");
  }

  const [duplicate] = await db
    .select({ username: users.username, cid: users.cid })
    .from(users)
    .where(and(ne(users.id, targetUserId), or(eq(users.username, username), eq(users.cid, cid))))
    .limit(1);
  if (duplicate) {
    throw conflict(`That ${duplicate.username === username ? "email user ID" : "CID"} is already registered.`);
  }

  const updated = await db
    .update(users)
    .set({
      username,
      cid,
      displayName: input.displayName.trim(),
      designation: input.designation.trim(),
      role: input.role,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, targetUserId), eq(users.active, true)))
    .returning({ id: users.id });

  if (!updated.length) throw conflict("The user could not be updated.");

  // A changed sign-in name or role invalidates other devices' sessions.
  if (targetUserId !== actor.id && (target.username !== username || target.role !== input.role)) {
    await destroyUserSessions(targetUserId);
  }

  await audit(
    actor.id,
    "user_updated",
    "user",
    targetUserId,
    `${input.displayName}, ${input.designation}, ${roleLabels[input.role]}`,
  );
}

export async function updateUserRole(actor: SessionUser, targetUserId: number, role: AppRole): Promise<void> {
  if (targetUserId === actor.id) throw conflict("An administrator cannot change their own role.");

  const [target] = await db
    .select({ role: users.role, active: users.active, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw notFound("The selected user was not found.");
  if (target.role === "agency_admin" && role !== "agency_admin" && (await activeAdminCount()) <= 1) {
    throw conflict("The last active Admin must retain the Admin role.");
  }

  const updated = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(users.id, targetUserId), eq(users.active, true)))
    .returning({ id: users.id });
  if (!updated.length) throw conflict("A deleted or inactive user cannot be assigned a role.");

  await destroyUserSessions(targetUserId);
  await audit(actor.id, "role_changed", "user", targetUserId, `Assigned ${roleLabels[role]}`);
}

/**
 * Soft-deletes a user: access and sessions are revoked immediately while every
 * voucher, approval and audit entry keeps their name.
 */
export async function deleteUser(actor: SessionUser, targetUserId: number): Promise<void> {
  if (targetUserId === actor.id) throw conflict("You cannot delete your own signed-in account.");

  const [target] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!target) throw notFound("The selected user was not found.");
  if (!target.active || target.deletedAt) throw conflict("This user has already been deleted.");
  if (target.role === "agency_admin" && (await activeAdminCount()) <= 1) {
    throw conflict("The last active Admin cannot be deleted.");
  }

  const now = new Date();
  const deleted = await db
    .update(users)
    .set({ active: false, deletedAt: now, deletedBy: actor.id, updatedAt: now })
    .where(and(eq(users.id, targetUserId), eq(users.active, true)))
    .returning({ id: users.id });

  if (!deleted.length) throw conflict("This user has already been deleted.");

  await destroyUserSessions(targetUserId);
  await audit(
    actor.id,
    "user_deleted",
    "user",
    targetUserId,
    `${target.displayName} (${target.username}) deleted; accounting history preserved`,
  );
}
