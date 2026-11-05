import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { asyncHandler, validateBody } from "../../lib/http.js";
import { unauthorized } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimit, passwordResetRateLimit } from "../../middleware/security.js";
import {
  changePassword,
  clearSessionCookie,
  createSession,
  destroySession,
  login,
  passwordPolicy,
  publicUser,
  requestPasswordReset,
  resetPassword,
  setSessionCookie,
} from "./auth.service.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";

const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username and password.").max(254),
  password: z.string().min(1, "Enter your username and password.").max(512),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(512),
  newPassword: z.string().min(1, "Enter a new password.").max(512),
  confirmPassword: z.string().min(1, "Confirm the new password.").max(512),
});

const forgotPasswordSchema = z.object({
  username: z.string().trim().min(1, "Enter your email address.").max(254),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, "This reset link is incomplete. Open it again from your email.").max(200),
  newPassword: z.string().min(1, "Enter a new password.").max(512),
  confirmPassword: z.string().min(1, "Confirm the new password.").max(512),
});

const resetPageUrl = () => `${env.APP_URL.replace(/\/$/, "")}/login/reset-password`;

export const authRouter = Router();

/** Current session, used by the client to restore state on load. */
authRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    if (!req.user) throw unauthorized();
    res.json({ user: publicUser(req.user), policy: passwordPolicy });
  }),
);

authRouter.post(
  "/login",
  authRateLimit,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const user = await login(req.body.username, req.body.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.maxAge);
    res.json({ user: publicUser(user), policy: passwordPolicy });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.sessionTokenHash) await destroySession(req.sessionTokenHash);
    if (req.user) await audit(req.user.id, "logout", "user", req.user.id, "Signed out");
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/password",
  requireAuth,
  authRateLimit,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    if (!req.user) throw unauthorized();
    const user = await changePassword(req.user, req.body, req.sessionTokenHash);
    res.json({ user: publicUser(user), policy: passwordPolicy });
  }),
);

/**
 * Always answers at once and the same way; the lookup and email run after the
 * response, so neither the answer nor its timing reveals a registered address.
 */
authRouter.post(
  "/forgot-password",
  passwordResetRateLimit,
  validateBody(forgotPasswordSchema),
  (req, res) => {
    void requestPasswordReset(req.body.username, resetPageUrl()).catch((error: unknown) => {
      logger.error({ err: error }, "Password reset request failed");
    });
    res.json({ ok: true });
  },
);

authRouter.post(
  "/reset-password",
  passwordResetRateLimit,
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await resetPassword(req.body);
    res.json({ ok: true });
  }),
);
