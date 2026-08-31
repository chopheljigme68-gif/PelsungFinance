import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validateBody } from "../../lib/http.js";
import { unauthorized } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimit } from "../../middleware/security.js";
import {
  changePassword,
  clearSessionCookie,
  createSession,
  destroySession,
  login,
  passwordPolicy,
  publicUser,
  setSessionCookie,
} from "./auth.service.js";
import { audit } from "../../lib/audit.js";

const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username and password.").max(254),
  password: z.string().min(1, "Enter your username and password.").max(512),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(512),
  newPassword: z.string().min(1, "Enter a new password.").max(512),
  confirmPassword: z.string().min(1, "Confirm the new password.").max(512),
});

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
