import { Router } from "express";
import { checkDatabase } from "../db/client.js";
import { asyncHandler } from "../lib/http.js";
import { requireAuth, requireTransactionalUser } from "../middleware/auth.js";
import { getAccountingSnapshot } from "../modules/accounting/accounting.controller.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { budgetRouter } from "../modules/budget/budget.routes.js";
import { payrollRouter } from "../modules/payroll/payroll.routes.js";
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
apiRouter.use("/remittance", remittanceRouter);
apiRouter.use("/users", userRouter);
