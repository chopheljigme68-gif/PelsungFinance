import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { badRequest } from "./errors.js";

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T>(handler: (req: Request, res: Response, next: NextFunction) => Promise<T>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The submitted values are not valid.";
  return issue.message;
}

/** Validates `req.body` and replaces it with the parsed value. */
export function validateBody<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(badRequest(firstIssueMessage(result.error)));
    req.body = result.data;
    next();
  };
}

/** Validates `req.query`; the parsed value is stashed on `res.locals.query`. */
export function validateQuery<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) return next(badRequest(firstIssueMessage(result.error)));
    res.locals.query = result.data;
    next();
  };
}

/** Validates `req.params`. */
export function validateParams<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) return next(badRequest(firstIssueMessage(result.error)));
    res.locals.params = result.data;
    next();
  };
}

export function query<T>(res: Response): T {
  return res.locals.query as T;
}

export function params<T>(res: Response): T {
  return res.locals.params as T;
}
