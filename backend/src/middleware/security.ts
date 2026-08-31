import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

/**
 * CSRF defence for a cookie session: every state-changing request must carry an
 * Origin (or Referer) header from an allow-listed browser origin. Combined with
 * `SameSite` on the session cookie this blocks cross-site form posts, and it
 * costs nothing for same-origin or native API clients that send no Origin.
 */
export const verifyRequestOrigin: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const origin = req.get("origin") ?? originOf(req.get("referer"));
  if (!origin) return next();
  if (env.corsOrigins.includes(origin)) return next();

  const selfOrigin = `${req.protocol}://${req.get("host") ?? ""}`;
  if (origin === selfOrigin) return next();

  next(forbidden("Request origin could not be verified."));
};

function originOf(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Broad protection against scripted abuse of the whole API. */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isProduction ? 300 : 3_000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
});

/** Tight limit on credential endpoints, on top of per-account lockout. */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isProduction ? 30 : 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many sign-in attempts from this address. Try again in a few minutes." },
});
