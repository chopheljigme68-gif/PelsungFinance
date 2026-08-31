import { Router } from "express";
import { z } from "zod";
import { normalizePayMonth } from "../../domain/fiscal-year.js";
import { badRequest } from "../../lib/errors.js";
import { asyncHandler, validateBody } from "../../lib/http.js";
import { currentUser, requirePermission } from "../../middleware/auth.js";
import { requestedFiscalYear, respondWithSnapshot } from "../accounting/accounting.controller.js";
import { finalizePayrollRemittance, finalizeSupplierTdsRemittance, postPayrollRemittance } from "./remittance.service.js";

const payrollRemittanceSchema = z.object({
  fiscalYear: z.string().optional(),
  payMonth: z.string(),
});

const supplierTdsSchema = z.object({
  fiscalYear: z.string().optional(),
  payMonth: z.string(),
  tdsRate: z.union([z.literal(2), z.literal(5)], { message: "Select either the 2% or 5% supplier TDS schedule." }),
});

export const remittanceRouter = Router();

remittanceRouter.post(
  "/payroll/finalize",
  requirePermission("manage_payroll"),
  validateBody(payrollRemittanceSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    const payMonth = normalizePayMonth(req.body.payMonth, fiscalYear);
    if (!payMonth) throw badRequest("Select a valid salary month for TDS and HC remittance.");

    await finalizePayrollRemittance(currentUser(req), fiscalYear, payMonth);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

remittanceRouter.post(
  "/payroll/post",
  requirePermission("manage_payroll"),
  validateBody(payrollRemittanceSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    const payMonth = normalizePayMonth(req.body.payMonth, fiscalYear);
    if (!payMonth) throw badRequest("Select a valid finalized remittance month.");

    await postPayrollRemittance(currentUser(req), fiscalYear, payMonth);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

remittanceRouter.post(
  "/supplier-tds/finalize",
  requirePermission("create_voucher"),
  validateBody(supplierTdsSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    const payMonth = normalizePayMonth(req.body.payMonth, fiscalYear);
    if (!payMonth) throw badRequest("Select a valid month for the supplier TDS schedule.");

    await finalizeSupplierTdsRemittance(currentUser(req), fiscalYear, payMonth, req.body.tdsRate);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);
