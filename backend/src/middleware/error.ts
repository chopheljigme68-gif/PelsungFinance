import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { AppError, PG_CHECK_VIOLATION, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, isPostgresError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `No API route matches ${req.method} ${req.originalUrl}.` });
};

/**
 * Single JSON error shape: `{ error, ...details }`. Unexpected failures are
 * logged with their stack and reported generically so internal details and SQL
 * never reach the browser.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (error.status >= 500) logger.error({ err: error, path: req.originalUrl }, "Request failed");
    res.status(error.status).json({ error: error.message, ...error.details });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "The submitted values are not valid." });
    return;
  }

  if (isPostgresError(error, PG_UNIQUE_VIOLATION)) {
    logger.warn({ err: error, path: req.originalUrl }, "Unique constraint violated");
    res.status(409).json({ error: "That record already exists. Refresh and try again." });
    return;
  }

  if (isPostgresError(error, PG_CHECK_VIOLATION)) {
    logger.warn({ err: error, path: req.originalUrl }, "Check constraint violated");
    res.status(400).json({ error: "The submitted values are outside the limits this record allows." });
    return;
  }

  if (isPostgresError(error, PG_FOREIGN_KEY_VIOLATION)) {
    logger.warn({ err: error, path: req.originalUrl }, "Foreign key violated");
    res.status(409).json({ error: "A referenced record no longer exists. Refresh and try again." });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "The request body could not be read as JSON." });
    return;
  }

  logger.error({ err: error, path: req.originalUrl }, "Unhandled error");
  res.status(500).json({
    error: "The request could not be completed. Please try again.",
    ...(env.isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  });
};
