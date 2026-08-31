/**
 * Every failure the API reports deliberately is an `AppError`. The error
 * middleware turns it into `{ error, ...details }`, which is the exact shape
 * the client already understands (it reads `availableBalanceNu`,
 * `outstandingAdvanceNu` and friends off the body).
 */
export class AppError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly expose: boolean;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new AppError(400, message, details);
export const unauthorized = (message = "Please sign in to continue.") => new AppError(401, message);
export const forbidden = (message = "Your assigned role does not permit this action.") => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string, details?: Record<string, unknown>) => new AppError(409, message, details);
export const preconditionRequired = (message: string) => new AppError(428, message);
export const tooManyRequests = (message: string) => new AppError(429, message);
export const serverError = (message = "The request could not be completed. Please try again.") =>
  new AppError(500, message);

/** Postgres unique-violation code, used to convert races into friendly 409s. */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
export const PG_FOREIGN_KEY_VIOLATION = "23503";

export function isPostgresError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}
