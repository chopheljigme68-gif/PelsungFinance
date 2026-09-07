import { Router } from "express";
import { env } from "../config/env.js";
import { checkDatabase } from "../db/client.js";
import { asyncHandler } from "../lib/http.js";
import { requireAuth, requireTransactionalUser } from "../middleware/auth.js";
import { getAccountingSnapshot } from "../modules/accounting/accounting.controller.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { budgetRouter } from "../modules/budget/budget.routes.js";
import { payrollRouter } from "../modules/payroll/payroll.routes.js";
import { reconciliationRouter } from "../modules/reconciliation/reconciliation.routes.js";
import { remittanceRouter } from "../modules/remittance/remittance.routes.js";
import { userRouter } from "../modules/users/user.routes.js";
import { voucherRouter } from "../modules/vouchers/voucher.routes.js";

export const apiRouter = Router();

apiRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const database = await checkDatabase();
    res.status(database ? 200 : 503).json({
      status: database ? "ok" : "degraded",
      database: database ? "connected" : "unavailable",
      // Echoed so a CORS failure can be diagnosed without shell access: compare
      // this list against the exact origin the browser reports. These are
      // public URLs, so publishing them reveals nothing a visitor cannot see.
      corsOrigins: env.corsOrigins,
      // Email config presence — NOT the secret values, just whether each is set,
      // so "works local, fails deployed" can be diagnosed by opening this URL.
      email: {
        transport: env.emailTransport, // agentmail | smtp | resend | none
        agentmailApiKeySet: Boolean(env.AGENTMAIL_API_KEY?.trim()),
        agentmailInboxSet: Boolean(env.AGENTMAIL_INBOX_ID?.trim()),
      },
      time: new Date().toISOString(),
    });
  }),
);

apiRouter.use("/auth", authRouter);

/** The read model — any signed-in role, including Viewer. */
apiRouter.get("/accounting", requireAuth, getAccountingSnapshot);

/**
 * Every mutation shares the same gate: signed in, temporary password already
 * replaced, and not the read-only Viewer role. Per-action permissions are
 * applied inside each router.
 */
apiRouter.use(requireAuth, requireTransactionalUser);
apiRouter.use("/budget", budgetRouter);
apiRouter.use("/vouchers", voucherRouter);
apiRouter.use("/payroll", payrollRouter);
apiRouter.use("/reconciliation", reconciliationRouter);
apiRouter.use("/remittance", remittanceRouter);
apiRouter.use("/users", userRouter);
