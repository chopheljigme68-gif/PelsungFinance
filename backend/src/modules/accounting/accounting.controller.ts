import type { Request, Response } from "express";
import { z } from "zod";
import { normalizeFiscalYear } from "../../domain/fiscal-year.js";
import { asyncHandler } from "../../lib/http.js";
import { currentUser } from "../../middleware/auth.js";
import { loadAccountingData } from "./accounting.service.js";
import type { PayslipDelivery } from "./accounting.types.js";

export const fiscalYearQuerySchema = z.object({
  fiscalYear: z.string().optional(),
});

/** Fiscal year for the request — query string first, then body, then default. */
export function requestedFiscalYear(req: Request): string {
  const fromQuery = (req.query?.fiscalYear as string | undefined) ?? undefined;
  const fromBody = (req.body as { fiscalYear?: unknown } | undefined)?.fiscalYear;
  return normalizeFiscalYear(fromQuery ?? fromBody);
}

/**
 * Every mutation answers with the refreshed snapshot for the active fiscal
 * year, so a client never has to reconcile a local mutation against the
 * server's derived balances.
 */
export async function respondWithSnapshot(
  req: Request,
  res: Response,
  extras: { actionNotice?: string | null; payrollPayslipDelivery?: PayslipDelivery | null } = {},
  status = 200,
): Promise<void> {
  const user = currentUser(req);
  const data = await loadAccountingData(user, requestedFiscalYear(req));
  res.status(status).json({
    ...data,
    ...(extras.payrollPayslipDelivery ? { payrollPayslipDelivery: extras.payrollPayslipDelivery } : {}),
    ...(extras.actionNotice ? { actionNotice: extras.actionNotice } : {}),
  });
}

export const getAccountingSnapshot = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  res.json(await loadAccountingData(user, requestedFiscalYear(req)));
});
