import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { tpnRegistrations } from "../../db/schema.js";
import { TPN_PATTERN } from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, isPostgresError, notFound, PG_UNIQUE_VIOLATION } from "../../lib/errors.js";
import type { SessionUser } from "../auth/auth.service.js";

/** Registers a taxpayer number so it can be chosen on TDS vouchers. */
export async function registerTpn(
  actor: SessionUser,
  input: { tpn: string; name: string },
): Promise<{ actionNotice: string }> {
  const tpn = String(input.tpn ?? "").trim().toLocaleUpperCase();
  const name = String(input.name ?? "").trim();
  if (!(tpn.length >= 3 && tpn.length <= 30 && TPN_PATTERN.test(tpn))) {
    throw badRequest("Enter a valid TPN (letters, digits and . / - only).");
  }
  if (!(name.length >= 1 && name.length <= 160)) throw badRequest("Enter the taxpayer's name.");

  try {
    const [created] = await db
      .insert(tpnRegistrations)
      .values({ tpn, name, createdBy: actor.id })
      .returning({ id: tpnRegistrations.id });
    await audit(actor.id, "tpn_registered", "tpn_registration", created.id, `${tpn} · ${name}`);
    return { actionNotice: `TPN ${tpn} (${name}) was registered.` };
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION)) throw conflict(`TPN ${tpn} is already registered.`);
    throw error;
  }
}

/** Removes a TPN from the registry. Existing vouchers keep their recorded TPN. */
export async function deleteTpnRegistration(actor: SessionUser, id: number): Promise<{ actionNotice: string }> {
  const [existing] = await db
    .select({ id: tpnRegistrations.id, tpn: tpnRegistrations.tpn })
    .from(tpnRegistrations)
    .where(eq(tpnRegistrations.id, id))
    .limit(1);
  if (!existing) throw notFound("That TPN registration no longer exists.");
  await db.delete(tpnRegistrations).where(eq(tpnRegistrations.id, id));
  await audit(actor.id, "tpn_removed", "tpn_registration", id, existing.tpn);
  return { actionNotice: `TPN ${existing.tpn} was removed from the registry.` };
}

/** True when a TPN exists in the registry — enforced on TDS vouchers. */
export async function isTpnRegistered(tpn: string): Promise<boolean> {
  const normalized = String(tpn ?? "").trim().toLocaleUpperCase();
  if (!normalized) return false;
  const [row] = await db
    .select({ id: tpnRegistrations.id })
    .from(tpnRegistrations)
    .where(eq(tpnRegistrations.tpn, normalized))
    .limit(1);
  return Boolean(row);
}
