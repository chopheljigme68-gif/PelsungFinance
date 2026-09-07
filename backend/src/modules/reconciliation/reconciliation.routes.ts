import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validateBody } from "../../lib/http.js";
import { moneyNonNegative, moneyPositive } from "../../lib/money.js";
import { currentUser, requirePermission } from "../../middleware/auth.js";
import { requestedFiscalYear, respondWithSnapshot } from "../accounting/accounting.controller.js";
import { closeMonth, saveBankReconciliation } from "./reconciliation.service.js";

export const reconciliationRouter = Router();

const itemSchema = z.object({
  itemType: z.enum(["add", "less"]),
  transactionDate: z.string().optional().default(""),
  reference: z.string().trim().max(80).optional().default(""),
  particulars: z.string().trim().min(1, "Enter the particulars.").max(240),
  amountNu: moneyPositive,
});

const saveSchema = z.object({
  fiscalYear: z.string().optional(),
  accountNumber: z.string().trim().min(1),
  statementMonth: z.string(),
  bankStatementWithdrawalsNu: moneyNonNegative,
  reconcile: z.boolean().optional(),
  items: z.array(itemSchema).max(100).optional(),
});

const closeSchema = z.object({
  fiscalYear: z.string().optional(),
  accountNumber: z.string().trim().min(1),
  closeMonth: z.string(),
});

reconciliationRouter.post(
  "/bank",
  requirePermission("manage_bank_reconciliation"),
  validateBody(saveSchema),
  asyncHandler(async (req, res) => {
    const { actionNotice } = await saveBankReconciliation(currentUser(req), requestedFiscalYear(req), req.body);
    await respondWithSnapshot(req, res, { actionNotice });
  }),
);

reconciliationRouter.post(
  "/month-close",
  requirePermission("manage_month_close"),
  validateBody(closeSchema),
  asyncHandler(async (req, res) => {
    const { actionNotice } = await closeMonth(currentUser(req), requestedFiscalYear(req), req.body);
    await respondWithSnapshot(req, res, { actionNotice });
  }),
);
