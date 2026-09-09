import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validateBody, validateParams } from "../../lib/http.js";
import { currentUser, requirePermission } from "../../middleware/auth.js";
import { respondWithSnapshot } from "../accounting/accounting.controller.js";
import { deleteTpnRegistration, registerTpn } from "./tpn.service.js";

export const tpnRouter = Router();

const registerSchema = z.object({
  tpn: z.string().trim().min(3, "Enter a valid TPN.").max(30),
  name: z.string().trim().min(1, "Enter the taxpayer's name.").max(160),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

tpnRouter.post(
  "/",
  requirePermission("manage_tpn"),
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { actionNotice } = await registerTpn(currentUser(req), req.body);
    await respondWithSnapshot(req, res, { actionNotice }, 201);
  }),
);

tpnRouter.delete(
  "/:id",
  requirePermission("manage_tpn"),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const { actionNotice } = await deleteTpnRegistration(currentUser(req), Number(req.params.id));
    await respondWithSnapshot(req, res, { actionNotice });
  }),
);
