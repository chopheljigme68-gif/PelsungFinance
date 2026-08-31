import type { SessionUser } from "../modules/auth/auth.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requireAuth`; never present on public routes. */
      user?: SessionUser;
      sessionTokenHash?: string;
    }
  }
}

export {};
