import { Router } from "express";
import { z } from "zod";
import { MAX_AMOUNT_NU } from "../../domain/vouchers.js";
import { asyncHandler, validateBody } from "../../lib/http.js";
import { currentUser, requirePermission } from "../../middleware/auth.js";
import { requestedFiscalYear, respondWithSnapshot } from "../accounting/accounting.controller.js";
import { addBudgetActivity, addSupplementaryBudget, reappropriateBudget } from "./budget.service.js";

const money = z.coerce
  .number()
  .int("Enter a whole Ngultrum amount.")
  .positive("Enter a positive amount.")
  .max(MAX_AMOUNT_NU, "That amount is larger than this system records.");

const addActivitySchema = z.object({
  fiscalYear: z.string().optional(),
  category: z.string().trim().min(1, "Enter the programme or category.").max(120),
  financing: z.string().trim().min(1, "Enter the financing source.").max(80),
  obc: z.string().trim().min(1, "Enter the OBC code.").max(30),
  activity: z.string().trim().min(1, "Enter the activity name.").max(240),
  budgetType: z.enum(["Current", "Capital"], { message: "Select Current or Capital." }),
  approvedNu: money,
  brief: z.string().trim().min(1, "Describe the approved purpose.").max(500),
});

const reappropriationSchema = z
  .object({
    fiscalYear: z.string().optional(),
    sourceActivityId: z.coerce.number().int().positive("Select the source activity."),
    destinationActivityId: z.coerce.number().int().positive("Select the destination activity."),
    amountNu: money,
    reason: z.string().trim().min(5, "Provide a reason of at least 5 characters.").max(500),
  })
  .refine((value) => value.sourceActivityId !== value.destinationActivityId, {
    message: "Select two different budget activities.",
    path: ["destinationActivityId"],
  });

const supplementarySchema = z.object({
  fiscalYear: z.string().optional(),
  activityId: z.coerce.number().int().positive("Select an existing budget activity."),
  amountNu: money,
  reason: z.string().trim().min(5, "Provide a reason of at least 5 characters.").max(500),
});

export const budgetRouter = Router();

budgetRouter.post(
  "/activities",
  requirePermission("manage_budget"),
  validateBody(addActivitySchema),
  asyncHandler(async (req, res) => {
    await addBudgetActivity(currentUser(req), requestedFiscalYear(req), req.body);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

budgetRouter.post(
  "/reappropriations",
  requirePermission("reappropriate_budget"),
  validateBody(reappropriationSchema),
  asyncHandler(async (req, res) => {
    await reappropriateBudget(currentUser(req), requestedFiscalYear(req), req.body);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

budgetRouter.post(
  "/supplementary",
  requirePermission("supplementary_budget"),
  validateBody(supplementarySchema),
  asyncHandler(async (req, res) => {
    await addSupplementaryBudget(currentUser(req), requestedFiscalYear(req), req.body);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);
