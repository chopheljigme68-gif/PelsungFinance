import { and, eq, sql as raw } from "drizzle-orm";
import { db } from "../../db/client.js";
import { budgetActivities, budgetReappropriations, supplementaryBudgets } from "../../db/schema.js";
import { MAX_AMOUNT_NU } from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { conflict, PG_UNIQUE_VIOLATION, isPostgresError, notFound } from "../../lib/errors.js";
import { loadActivityBalances } from "../accounting/accounting.service.js";
import type { SessionUser } from "../auth/auth.service.js";

const ngultrum = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export type AddBudgetActivityInput = {
  category: string;
  financing: string;
  obc: string;
  activity: string;
  budgetType: "Current" | "Capital";
  approvedNu: number;
  brief: string;
};

export async function addBudgetActivity(
  user: SessionUser,
  fiscalYear: string,
  input: AddBudgetActivityInput,
): Promise<void> {
  const obc = input.obc.toLocaleUpperCase();

  // The approved budget legitimately repeats an OBC and activity title across
  // programmes, so a duplicate is only a duplicate within the same programme.
  const [duplicate] = await db
    .select({ id: budgetActivities.id })
    .from(budgetActivities)
    .where(
      and(
        eq(budgetActivities.fiscalYear, fiscalYear),
        eq(budgetActivities.obc, obc),
        raw`lower(${budgetActivities.activity}) = lower(${input.activity})`,
        raw`lower(${budgetActivities.category}) = lower(${input.category})`,
      ),
    )
    .limit(1);
  if (duplicate) throw conflict("That activity and OBC combination is already registered for this programme.");

  try {
    const [created] = await db
      .insert(budgetActivities)
      .values({
        fiscalYear,
        category: input.category,
        financing: input.financing,
        obc,
        activity: input.activity,
        budgetType: input.budgetType,
        approvedNu: input.approvedNu,
        brief: input.brief,
        createdBy: user.id,
      })
      .returning({ id: budgetActivities.id });

    await audit(
      user.id,
      "budget_activity_added",
      "budget_activity",
      created.id,
      `${fiscalYear} - ${obc} - ${input.activity} - Nu. ${input.approvedNu}`,
    );
  } catch (error) {
    if (isPostgresError(error, PG_UNIQUE_VIOLATION)) {
      throw conflict("That activity and OBC combination is already registered.");
    }
    throw error;
  }
}

export type ReappropriationInput = {
  sourceActivityId: number;
  destinationActivityId: number;
  amountNu: number;
  reason: string;
};

/**
 * Moves approved allocation between two activities of the same fiscal year.
 *
 * The source rows are locked for the duration of the transaction so two
 * concurrent transfers can never both pass the available-balance check.
 */
export async function reappropriateBudget(
  user: SessionUser,
  fiscalYear: string,
  input: ReappropriationInput,
): Promise<void> {
  const { sourceActivityId, destinationActivityId, amountNu, reason } = input;

  await db.transaction(async (tx) => {
    const balances = await loadActivityBalances(tx, fiscalYear, [sourceActivityId, destinationActivityId], true);
    const source = balances.get(sourceActivityId);
    const destination = balances.get(destinationActivityId);

    if (!source || !destination) {
      throw conflict("Both budget activities must belong to the selected financial year.");
    }
    if (amountNu > source.availableNu) {
      throw conflict(`Only Nu. ${ngultrum.format(source.availableNu)} is available in the source activity.`, {
        availableBalanceNu: source.availableNu,
      });
    }

    await tx
      .update(budgetActivities)
      .set({ approvedNu: raw`${budgetActivities.approvedNu} - ${amountNu}` })
      .where(and(eq(budgetActivities.id, sourceActivityId), eq(budgetActivities.fiscalYear, fiscalYear)));

    await tx
      .update(budgetActivities)
      .set({ approvedNu: raw`${budgetActivities.approvedNu} + ${amountNu}` })
      .where(and(eq(budgetActivities.id, destinationActivityId), eq(budgetActivities.fiscalYear, fiscalYear)));

    const [transfer] = await tx
      .insert(budgetReappropriations)
      .values({
        fiscalYear,
        sourceActivityId,
        destinationActivityId,
        amountNu,
        reason,
        transferredBy: user.id,
      })
      .returning({ id: budgetReappropriations.id });

    await audit(
      user.id,
      "budget_reappropriated",
      "budget_reappropriation",
      transfer.id,
      `${fiscalYear} - Nu. ${amountNu} from ${source.obc} ${source.activity} to ${destination.obc} ${destination.activity} - ${reason}`,
      tx,
    );
  });
}

export type SupplementaryBudgetInput = {
  activityId: number;
  amountNu: number;
  reason: string;
};

export async function addSupplementaryBudget(
  user: SessionUser,
  fiscalYear: string,
  input: SupplementaryBudgetInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [activity] = await tx
      .select({
        id: budgetActivities.id,
        obc: budgetActivities.obc,
        activity: budgetActivities.activity,
        approvedNu: budgetActivities.approvedNu,
      })
      .from(budgetActivities)
      .where(and(eq(budgetActivities.id, input.activityId), eq(budgetActivities.fiscalYear, fiscalYear)))
      .for("update")
      .limit(1);

    if (!activity) throw conflict("The selected budget activity does not belong to this financial year.");
    if (activity.approvedNu + input.amountNu > MAX_AMOUNT_NU) {
      throw conflict("The revised approved allocation would exceed the maximum amount this system records.");
    }

    await tx
      .update(budgetActivities)
      .set({ approvedNu: raw`${budgetActivities.approvedNu} + ${input.amountNu}` })
      .where(eq(budgetActivities.id, input.activityId));

    const [supplement] = await tx
      .insert(supplementaryBudgets)
      .values({
        fiscalYear,
        activityId: input.activityId,
        amountNu: input.amountNu,
        reason: input.reason,
        grantedBy: user.id,
      })
      .returning({ id: supplementaryBudgets.id });

    await audit(
      user.id,
      "supplementary_budget_added",
      "supplementary_budget",
      supplement.id,
      `${fiscalYear} - Nu. ${input.amountNu} added to ${activity.obc} ${activity.activity} - ${input.reason}`,
      tx,
    );
  });
}

export async function requireActivity(fiscalYear: string, activityId: number) {
  const [activity] = await db
    .select()
    .from(budgetActivities)
    .where(and(eq(budgetActivities.id, activityId), eq(budgetActivities.fiscalYear, fiscalYear)))
    .limit(1);
  if (!activity) throw notFound("The selected budget activity was not found in this financial year.");
  return activity;
}
