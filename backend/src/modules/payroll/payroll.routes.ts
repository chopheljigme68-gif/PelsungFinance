import { Router } from "express";
import { z } from "zod";
import { normalizePayMonth } from "../../domain/fiscal-year.js";
import { CID_PATTERN, EMAIL_PATTERN, MAX_AMOUNT_NU, TPN_PATTERN } from "../../domain/vouchers.js";
import { asyncHandler, validateBody, validateParams } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import { currentUser, requirePermission } from "../../middleware/auth.js";
import { requestedFiscalYear, respondWithSnapshot } from "../accounting/accounting.controller.js";
import {
  addDepartment,
  addEmployee,
  setEmployeeStatus,
  updateDepartment,
  updateEmployee,
  updateEmployeeIdentity,
} from "./employee.service.js";
import { finalizePayBill, postPayBill, undoPayBillPosting, unfinalizePayBill } from "./paybill.service.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });

const departmentSchema = z.object({
  fiscalYear: z.string().optional(),
  departmentName: z
    .string()
    .trim()
    .min(2, "Enter a department name between 2 and 120 characters.")
    .max(120, "Enter a department name between 2 and 120 characters."),
});

const payAmount = z.coerce.number().int().min(0).max(MAX_AMOUNT_NU);

const employeeSchema = z.object({
  fiscalYear: z.string().optional(),
  employeeNumber: z.string().trim().min(1, "Enter the employee number.").max(30),
  cid: z.string().trim().regex(CID_PATTERN, "Enter a valid 11-digit CID."),
  tpn: z
    .string()
    .trim()
    .max(30)
    .transform((value) => value.toLocaleUpperCase())
    .refine((value) => TPN_PATTERN.test(value), "Enter a valid TPN."),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((value) => value.toLocaleLowerCase())
    .refine((value) => EMAIL_PATTERN.test(value), "Enter a valid email ID."),
  fullName: z.string().trim().min(1, "Enter the full name.").max(120),
  designation: z.string().trim().min(1, "Enter the designation.").max(120),
  department: z.string().trim().min(1, "Select a department.").max(120),
  basicPayNu: z.coerce.number().int().positive("Enter a positive Basic Pay.").max(MAX_AMOUNT_NU),
  allowancesNu: payAmount.default(0),
  arrearNu: payAmount.default(0),
  advanceNu: payAmount.default(0),
});

const employeeStatusSchema = z.object({
  fiscalYear: z.string().optional(),
  status: z.enum(["Active", "Inactive"], { message: "Invalid employee status update." }),
});

const employeeIdentitySchema = z.object({
  fiscalYear: z.string().optional(),
  cid: z.string().trim().regex(CID_PATTERN, "Enter a valid 11-digit CID."),
  tpn: z
    .string()
    .trim()
    .max(30)
    .transform((value) => value.toLocaleUpperCase())
    .refine((value) => TPN_PATTERN.test(value), "Enter a valid TPN."),
});

const finalizePayBillSchema = z.object({
  fiscalYear: z.string().optional(),
  payMonth: z.string(),
  department: z.string().trim().min(1, "Select a valid employee department.").max(120),
  expectedGrossPayNu: z.coerce.number().int(),
  expectedRecoveriesNu: z.coerce.number().int(),
  expectedNetPayNu: z.coerce.number().int(),
});

const postPayBillSchema = z.object({
  fiscalYear: z.string().optional(),
  payMonth: z.string(),
  department: z.string().trim().min(1, "Select the finalized department pay bill to post.").max(120),
  budgetActivityId: z.coerce.number().int().positive("Select an approved budget activity before posting the pay bill."),
});

const payBillSelectionSchema = z.object({
  fiscalYear: z.string().optional(),
  payMonth: z.string(),
  department: z.string().trim().min(1, "Select a valid department pay bill.").max(120),
});

/** Validates the pay month against the fiscal year the request is scoped to. */
function payMonthFor(req: Parameters<typeof requestedFiscalYear>[0], payMonth: string): string {
  const normalized = normalizePayMonth(payMonth, requestedFiscalYear(req));
  if (!normalized) throw badRequest("Select a valid payroll month within the current financial year.");
  return normalized;
}

export const payrollRouter = Router();

/* Departments -------------------------------------------------------------- */

payrollRouter.post(
  "/departments",
  requirePermission("manage_departments"),
  validateBody(departmentSchema),
  asyncHandler(async (req, res) => {
    await addDepartment(currentUser(req), req.body.departmentName);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

payrollRouter.patch(
  "/departments/:id",
  requirePermission("manage_departments"),
  validateParams(idParams),
  validateBody(departmentSchema),
  asyncHandler(async (req, res) => {
    await updateDepartment(currentUser(req), Number(req.params.id), req.body.departmentName);
    await respondWithSnapshot(req, res);
  }),
);

/* Employees ---------------------------------------------------------------- */

payrollRouter.post(
  "/employees",
  requirePermission("add_employee"),
  validateBody(employeeSchema),
  asyncHandler(async (req, res) => {
    await addEmployee(currentUser(req), req.body);
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

payrollRouter.put(
  "/employees/:id",
  requirePermission("add_employee"),
  validateParams(idParams),
  validateBody(employeeSchema),
  asyncHandler(async (req, res) => {
    await updateEmployee(currentUser(req), Number(req.params.id), req.body);
    await respondWithSnapshot(req, res);
  }),
);

payrollRouter.patch(
  "/employees/:id/status",
  requirePermission("add_employee"),
  validateParams(idParams),
  validateBody(employeeStatusSchema),
  asyncHandler(async (req, res) => {
    await setEmployeeStatus(currentUser(req), Number(req.params.id), req.body.status);
    await respondWithSnapshot(req, res);
  }),
);

payrollRouter.patch(
  "/employees/:id/identity",
  requirePermission("add_employee"),
  validateParams(idParams),
  validateBody(employeeIdentitySchema),
  asyncHandler(async (req, res) => {
    await updateEmployeeIdentity(currentUser(req), Number(req.params.id), req.body);
    await respondWithSnapshot(req, res);
  }),
);

/* Pay bills ---------------------------------------------------------------- */

payrollRouter.post(
  "/pay-bills/finalize",
  requirePermission("manage_payroll"),
  validateBody(finalizePayBillSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    await finalizePayBill(currentUser(req), fiscalYear, {
      ...req.body,
      payMonth: payMonthFor(req, req.body.payMonth),
    });
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

payrollRouter.post(
  "/pay-bills/post",
  requirePermission("manage_payroll"),
  validateBody(postPayBillSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    await postPayBill(currentUser(req), fiscalYear, { ...req.body, payMonth: payMonthFor(req, req.body.payMonth) });
    await respondWithSnapshot(req, res, {}, 201);
  }),
);

payrollRouter.post(
  "/pay-bills/undo-posting",
  requirePermission("undo_payroll"),
  validateBody(payBillSelectionSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    await undoPayBillPosting(currentUser(req), fiscalYear, payMonthFor(req, req.body.payMonth), req.body.department);
    await respondWithSnapshot(req, res);
  }),
);

payrollRouter.post(
  "/pay-bills/unfinalize",
  requirePermission("undo_payroll"),
  validateBody(payBillSelectionSchema),
  asyncHandler(async (req, res) => {
    const fiscalYear = requestedFiscalYear(req);
    await unfinalizePayBill(currentUser(req), fiscalYear, payMonthFor(req, req.body.payMonth), req.body.department);
    await respondWithSnapshot(req, res);
  }),
);
