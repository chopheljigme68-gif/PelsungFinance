import { and, eq, isNotNull, isNull, sql as raw } from "drizzle-orm";
import { db, type DbExecutor } from "../../db/client.js";
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
        isNull(budgetActivities.deletedAt),
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
      .where(
        and(
          eq(budgetActivities.id, input.activityId),
          eq(budgetActivities.fiscalYear, fiscalYear),
          isNull(budgetActivities.deletedAt),
        ),
      )
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
    .where(
      and(
        eq(budgetActivities.id, activityId),
        eq(budgetActivities.fiscalYear, fiscalYear),
        isNull(budgetActivities.deletedAt),
      ),
    )
    .limit(1);
  if (!activity) throw notFound("The selected budget activity was not found in this financial year.");
  return activity;
}

/**
 * Counts every record that depends on an activity. An activity that money has
 * already moved through must never vanish from the books — the user reverses
 * the vouchers or re-appropriates the balance instead.
 */
async function activityUsage(tx: DbExecutor, activityId: number) {
  const rows = await tx.execute<{ vouchers: number; payroll: number; transfers: number; supplements: number }>(raw`
    SELECT
      (SELECT COUNT(DISTINCT v.id)::int FROM vouchers v
         LEFT JOIN voucher_budget_lines line ON line.voucher_id = v.id
        WHERE v.activity_id = ${activityId} OR line.activity_id = ${activityId}) AS "vouchers",
      (SELECT COUNT(*)::int FROM payroll_runs WHERE budget_activity_id = ${activityId}) AS "payroll",
      (SELECT COUNT(*)::int FROM budget_reappropriations
        WHERE source_activity_id = ${activityId} OR destination_activity_id = ${activityId}) AS "transfers",
      (SELECT COUNT(*)::int FROM supplementary_budgets WHERE activity_id = ${activityId}) AS "supplements"
  `);
  return (rows as unknown as { vouchers: number; payroll: number; transfers: number; supplements: number }[])[0];
}

export async function deleteBudgetActivity(
  user: SessionUser,
  fiscalYear: string,
  activityId: number,
  reason: string,
): Promise<{ actionNotice: string }> {
  return db.transaction(async (tx) => {
    const [activity] = await tx
      .select()
      .from(budgetActivities)
      .where(
        and(
          eq(budgetActivities.id, activityId),
          eq(budgetActivities.fiscalYear, fiscalYear),
          isNull(budgetActivities.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!activity) throw notFound("The budget activity was not found or has already been deleted.");

    const usage = await activityUsage(tx, activityId);
    const blockers = [
      usage.vouchers && `${usage.vouchers} voucher${usage.vouchers === 1 ? "" : "s"}`,
      usage.payroll && `${usage.payroll} pay bill${usage.payroll === 1 ? "" : "s"}`,
      usage.transfers && `${usage.transfers} re-appropriation${usage.transfers === 1 ? "" : "s"}`,
      usage.supplements && `${usage.supplements} supplementary budget${usage.supplements === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (blockers.length) {
      throw conflict(
        `${activity.obc} · ${activity.activity} cannot be deleted because it is used by ${blockers.join(", ")}. ` +
          "Reverse those vouchers or re-appropriate its balance to another activity instead.",
      );
    }

    await tx
      .update(budgetActivities)
      .set({ deletedAt: new Date(), deletedBy: user.id, deleteReason: reason })
      .where(eq(budgetActivities.id, activityId));

    await audit(
      user.id,
      "budget_activity_deleted",
      "budget_activity",
      activityId,
      `${fiscalYear} - ${activity.obc} - ${activity.activity} - Nu. ${activity.approvedNu} - ${reason}`,
      tx,
    );

    return {
      actionNotice: `${activity.obc} · ${activity.activity} was deleted. You can restore it from "Recently deleted activities".`,
    };
  });
}

export async function restoreBudgetActivity(
  user: SessionUser,
  fiscalYear: string,
  activityId: number,
): Promise<{ actionNotice: string }> {
  return db.transaction(async (tx) => {
    const [activity] = await tx
      .select()
      .from(budgetActivities)
      .where(
        and(
          eq(budgetActivities.id, activityId),
          eq(budgetActivities.fiscalYear, fiscalYear),
          isNotNull(budgetActivities.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!activity) throw notFound("The deleted budget activity was not found.");

    // Someone may have re-added the same activity after it was deleted.
    const [clash] = await tx
      .select({ id: budgetActivities.id })
      .from(budgetActivities)
      .where(
        and(
          eq(budgetActivities.fiscalYear, fiscalYear),
          eq(budgetActivities.obc, activity.obc),
          raw`lower(${budgetActivities.activity}) = lower(${activity.activity})`,
          raw`lower(${budgetActivities.category}) = lower(${activity.category})`,
          isNull(budgetActivities.deletedAt),
        ),
      )
      .limit(1);
    if (clash) throw conflict("An active activity with the same OBC and name already exists in this programme.");

    await tx
      .update(budgetActivities)
      .set({ deletedAt: null, deletedBy: null, deleteReason: null })
      .where(eq(budgetActivities.id, activityId));

    await audit(
      user.id,
      "budget_activity_restored",
      "budget_activity",
      activityId,
      `${fiscalYear} - ${activity.obc} - ${activity.activity} - Nu. ${activity.approvedNu}`,
      tx,
    );

    return { actionNotice: `${activity.obc} · ${activity.activity} was restored to the budget register.` };
  });
}
