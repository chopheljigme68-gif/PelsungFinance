import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { APP_ROLES } from "../../domain/permissions.js";
import { CID_PATTERN } from "../../domain/vouchers.js";
import { asyncHandler, validateBody, validateParams } from "../../lib/http.js";
import { currentUser, requirePermission } from "../../middleware/auth.js";
import { respondWithSnapshot } from "../accounting/accounting.controller.js";
import { createUser, deleteUser, resendInvitation, updateUser, updateUserRole } from "./user.service.js";

/** The sign-in page, so the link in an invitation lands where it should. */
const loginUrl = () => `${env.APP_URL.replace(/\/$/, "")}/login`;

const idParams = z.object({ id: z.coerce.number().int().positive("Select a valid user.") });

const userSchema = z.object({
  fiscalYear: z.string().optional(),
  username: z.string().trim().email("Enter a valid email user ID.").max(254),
  cid: z.string().trim().regex(CID_PATTERN, "Enter an 11-digit CID."),
  displayName: z.string().trim().min(1, "Enter the full name.").max(120),
  designation: z.string().trim().min(1, "Enter the designation.").max(120),
  role: z.enum(APP_ROLES, { message: "Select a valid role." }),
});

const roleSchema = z.object({
  fiscalYear: z.string().optional(),
  role: z.enum(APP_ROLES, { message: "Select a valid role." }),
});

export const userRouter = Router();

userRouter.use(requirePermission("manage_users"));

userRouter.post(
  "/",
  validateBody(userSchema),
  asyncHandler(async (req, res) => {
    const { actionNotice } = await createUser(currentUser(req), req.body);
    await respondWithSnapshot(req, res, { actionNotice }, 201);
  }),
);

userRouter.put(
  "/:id",
  validateParams(idParams),
  validateBody(userSchema),
  asyncHandler(async (req, res) => {
    await updateUser(currentUser(req), Number(req.params.id), req.body);
    await respondWithSnapshot(req, res);
  }),
);

userRouter.patch(
  "/:id/role",
  requirePermission("assign_roles"),
  validateParams(idParams),
  validateBody(roleSchema),
  asyncHandler(async (req, res) => {
    await updateUserRole(currentUser(req), Number(req.params.id), req.body.role);
    await respondWithSnapshot(req, res);
  }),
);

userRouter.post(
  "/:id/invitation",
  validateParams(idParams),
  validateBody(z.object({ fiscalYear: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { actionNotice } = await resendInvitation(currentUser(req), Number(req.params.id), loginUrl());
    await respondWithSnapshot(req, res, { actionNotice });
  }),
);

userRouter.delete(
  "/:id",
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    await deleteUser(currentUser(req), Number(req.params.id));
    await respondWithSnapshot(req, res);
  }),
);