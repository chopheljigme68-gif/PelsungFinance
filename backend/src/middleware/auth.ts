import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Permission } from "../domain/permissions.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { SESSION_COOKIE, can, resolveSession } from "../modules/auth/auth.service.js";

/** Attaches `req.user` when a valid session cookie is present. Never rejects. */
export const attachUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  resolveSession(token)
    .then((session) => {
      if (session) {
        req.user = session.user;
        req.sessionTokenHash = session.tokenHash;
      }
      next();
    })
    .catch(next);
};

/** Requires an authenticated session. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

/**
 * Blocks the read-only `viewer` role from every mutation.
 *
 * A temporary password no longer blocks anything: signing in is enough to
 * transact, and changing the password stays available on demand from the
 * account menu. `users.must_change_password` is kept as a record of who has
 * not yet replaced their invitation password — User Management still shows it
 * and offers to resend the invitation — but it is not a gate.
 */
export const requireTransactionalUser: RequestHandler = (req, _res, next) => {
  const user = req.user;
  if (!user) return next(unauthorized());
  if (user.role === "viewer") return next(forbidden());
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (!can(user, permission)) return next(forbidden());
    next();
  };
}

/** Passes when the user holds at least one of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (!permissions.some((permission) => can(user, permission))) return next(forbidden());
    next();
  };
}

export function currentUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}