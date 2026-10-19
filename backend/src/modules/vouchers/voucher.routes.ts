import { Router } from "express";
import { z } from "zod";
import { BANKS, LEDGER_ACCOUNTS } from "../../domain/reference.js";
import { ISO_DATE_PATTERN, RECEIPT_CATEGORIES, VOUCHER_TYPES } from "../../domain/vouchers.js";
import { asyncHandler, validateBody, validateParams } from "../../lib/http.js";
import { moneyNonNegative, moneyPositive } from "../../lib/money.js";
import { currentUser, requireAnyPermission, requirePermission } from "../../middleware/auth.js";
import { requestedFiscalYear, respondWithSnapshot } from "../accounting/accounting.controller.js";
import type { PayslipDelivery } from "../accounting/accounting.types.js";
import {
  createVoucher,
  decideVoucher,
  deliverPayslipsForPayrollVoucher,
  reverseVoucher,
  submitVoucher,
} from "./voucher.service.js";

const idParams = z.object({ id: z.coerce.number().int().positive("Select a valid voucher.") });

const budgetLineSchema = z.object({
  activityId: z.coerce.number().int().positive(),
  amountNu: moneyPositive,
});

const createVoucherSchema = z.object({
  fiscalYear: z.string().optional(),
  voucherType: z.enum(VOUCHER_TYPES, { message: "Select a valid voucher type." }),
  payee: z.string().trim().min(1, "Enter the payee.").max(160),
  tpn: z.string().trim().max(30).nullish(),
  payeeAccountNumber: z
    .string()
    .trim()
    .max(30)
    .regex(/^[A-Za-z0-9-]*$/, "Enter a valid account number.")
    .nullish(),
  payeeBankName: z
    .string()
    .trim()
    .max(60)
    .refine((v) => !v || (BANKS as readonly string[]).includes(v), "Select a bank from the list.")
    .nullish(),
  billReference: z.string().trim().max(120).nullish(),
  description: z.string().trim().min(1, "Enter the particulars.").max(500),
  amountNu: moneyNonNegative.optional(),
  gstNu: moneyNonNegative.optional(),
  tdsRate: z.union([z.literal(0), z.literal(2), z.literal(5)]).optional(),
  advanceRecoveryNu: moneyNonNegative.optional(),
  advanceRecoveryVoucherId: z.coerce.number().int().positive().nullish(),
  transactionDate: z.string().regex(ISO_DATE_PATTERN, "Enter a valid transaction date."),
  budgetLines: z.array(budgetLineSchema).max(25).optional(),
  activityId: z.coerce.number().int().positive().nullish(),
  ledgerCode: z
    .string()
    .trim()
    .refine((v) => LEDGER_ACCOUNTS.some((ledger) => ledger.code === v), "Select a valid bank or cash ledger.")
    .nullish(),
  receiptCategory: z.enum(RECEIPT_CATEGORIES, { message: "Select a valid receipt category." }).nullish(),
});

const decisionSchema = z.object({
  fiscalYear: z.string().optional(),
  status: z.enum(["Approved", "Rejected"], { message: "Invalid voucher approval action." }),
});

const reversalSchema = z.object({
  fiscalYear: z.string().optional(),
  reversalReason: z
    .string()
    .trim()
    .min(5, "Enter a reversal reason between 5 and 500 characters.")
    .max(500, "Enter a reversal reason between 5 and 500 characters."),
});

export const voucherRouter = Router();

voucherRouter.post(
  "/",
  requireAnyPermission("create_voucher", "record_fund_receipt"),
  validateBody(createVoucherSchema),
  asyncHandler(async (req, res) => {
    await createVoucher(currentUser(req), requestedFiscalYear(req), req.body);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

voucherRouter.post(
  "/:id/submit",
  validateParams(idParams),
  validateBody(z.object({ fiscalYear: z.string().optional() })),
  asyncHandler(async (req, res) => {
    await submitVoucher(currentUser(req), requestedFiscalYear(req), Number(req.params.id));
    await respondWithSnapshot(req, res);
  }),
);

voucherRouter.patch(
  "/:id/status",
  requirePermission("approve_voucher"),
  validateParams(idParams),
  validateBody(decisionSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const voucherId = Number(req.params.id);
    const { status } = req.body as { status: "Approved" | "Rejected" };

    const decision = await decideVoucher(user, requestedFiscalYear(req), voucherId, status);

    // Payslip email delivery happens only after the approval has committed.
    let payrollPayslipDelivery: PayslipDelivery | null = null;
    if (status === "Approved" && decision.payrollEntryType === "combined" && decision.payrollRunId) {
      payrollPayslipDelivery = await deliverPayslipsForPayrollVoucher(user, voucherId, decision.payrollRunId);
    }

    await respondWithSnapshot(req, res, { payrollPayslipDelivery });
  }),
);

voucherRouter.post(
  "/:id/reverse",
  requirePermission("approve_voucher"),
  validateParams(idParams),
  validateBody(reversalSchema),
  asyncHandler(async (req, res) => {
    await reverseVoucher(currentUser(req), Number(req.params.id), req.body.reversalReason);
    await respondWithSnapshot(req, res);
  }),
);