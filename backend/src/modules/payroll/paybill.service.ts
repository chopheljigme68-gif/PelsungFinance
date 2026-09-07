import { and, asc, eq, sql as raw } from "drizzle-orm";
import { db } from "../../db/client.js";
import { employees, payrollRunItems, payrollRuns, voucherBudgetLines, vouchers } from "../../db/schema.js";
import { monthEndDate, payBillReference } from "../../domain/fiscal-year.js";
import { calculateBhutanMonthlyPayrollTax, calculateHealthContribution } from "../../domain/payroll-tax.js";
import { EMAIL_PATTERN, formatVoucherNumber } from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { isAccountingMonthClosed } from "../reconciliation/reconciliation.service.js";
import { loadActivityBalances, nextVoucherSerial } from "../accounting/accounting.service.js";
import type { SessionUser } from "../auth/auth.service.js";
import { deleteUnapprovedPayrollVouchers } from "../vouchers/voucher.service.js";

export type FinalizePayBillInput = {
  payMonth: string;
  department: string;
  expectedGrossPayNu: number;
  expectedRecoveriesNu: number;
  expectedNetPayNu: number;
};

/**
 * Locks one department's payroll for a month.
 *
 * The client sends the totals it displayed; if the register moved in the
 * meantime the figures will not match and the pay bill is refused rather than
 * silently locking numbers the approver never saw.
 */
export async function finalizePayBill(
  user: SessionUser,
  fiscalYear: string,
  input: FinalizePayBillInput,
): Promise<void> {
  const department = input.department.trim().normalize("NFC");

  if (await isAccountingMonthClosed(fiscalYear, input.payMonth)) {
    throw conflict("A pay bill cannot be finalized for a closed accounting month.");
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: payrollRuns.id, status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.fiscalYear, fiscalYear),
          eq(payrollRuns.payMonth, input.payMonth),
          eq(payrollRuns.department, department),
        ),
      )
      .limit(1);

    if (existing) {
      throw conflict(
        `The ${department} pay bill for ${input.payMonth} has already been ${existing.status.toLocaleLowerCase()}.`,
      );
    }

    const roster = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.status, "Active"), eq(employees.department, department)))
      .orderBy(asc(employees.employeeNumber));

    if (!roster.length) throw conflict(`There are no active employees in ${department}.`);

    const withoutEmail = roster.find((employee) => !employee.email || !EMAIL_PATTERN.test(employee.email));
    if (withoutEmail) {
      throw conflict(
        `Add a valid email ID for ${withoutEmail.fullName} (${withoutEmail.employeeNumber}) before finalizing this pay bill. Payslips are emailed after payroll voucher approval.`,
      );
    }

    const snapshot = roster.map((employee) => {
      const basicPayNu = employee.basicPayNu || employee.grossPayNu;
      const tax = calculateBhutanMonthlyPayrollTax(employee.grossPayNu);
      const healthContributionNu = calculateHealthContribution(employee.grossPayNu);
      const recoveriesNu = tax.taxOnSalaryNu + healthContributionNu + employee.advanceNu;
      return {
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        cid: employee.cid,
        tpn: employee.tpn,
        email: employee.email,
        fullName: employee.fullName,
        designation: employee.designation,
        department: employee.department,
        basicPayNu,
        allowancesNu: employee.allowancesNu,
        arrearNu: employee.arrearNu,
        grossPayNu: employee.grossPayNu,
        taxOnSalaryNu: tax.taxOnSalaryNu,
        healthContributionNu,
        advanceNu: employee.advanceNu,
        recoveriesNu,
        netPayNu: employee.grossPayNu - recoveriesNu,
      };
    });

    const totals = snapshot.reduce(
      (total, employee) => ({
        basicPayNu: total.basicPayNu + employee.basicPayNu,
        allowancesNu: total.allowancesNu + employee.allowancesNu,
        arrearNu: total.arrearNu + employee.arrearNu,
        grossPayNu: total.grossPayNu + employee.grossPayNu,
        taxOnSalaryNu: total.taxOnSalaryNu + employee.taxOnSalaryNu,
        healthContributionNu: total.healthContributionNu + employee.healthContributionNu,
        advanceNu: total.advanceNu + employee.advanceNu,
        recoveriesNu: total.recoveriesNu + employee.recoveriesNu,
        netPayNu: total.netPayNu + employee.netPayNu,
      }),
      {
        basicPayNu: 0,
        allowancesNu: 0,
        arrearNu: 0,
        grossPayNu: 0,
        taxOnSalaryNu: 0,
        healthContributionNu: 0,
        advanceNu: 0,
        recoveriesNu: 0,
        netPayNu: 0,
      },
    );

    if (
      input.expectedGrossPayNu !== totals.grossPayNu ||
      input.expectedRecoveriesNu !== totals.recoveriesNu ||
      input.expectedNetPayNu !== totals.netPayNu
    ) {
      throw conflict(
        "The payroll register has changed and no longer matches this pay bill. Reopen the report and review the refreshed figures before finalizing.",
      );
    }

    const [run] = await tx
      .insert(payrollRuns)
      .values({
        fiscalYear,
        payMonth: input.payMonth,
        department,
        budgetActivityId: null,
        employeeCount: snapshot.length,
        ...totals,
        status: "Finalized",
        finalizedBy: user.id,
        finalizedAt: new Date(),
      })
      .returning({ id: payrollRuns.id });

    await tx.insert(payrollRunItems).values(snapshot.map((employee) => ({ ...employee, payrollRunId: run.id })));

    await audit(
      user.id,
      "pay_bill_finalized",
      "payroll_run",
      run.id,
      `${input.payMonth} · ${department}: gross Nu. ${totals.grossPayNu}, recoveries Nu. ${totals.recoveriesNu}, net Nu. ${totals.netPayNu}`,
      tx,
    );
  });
}

export type PostPayBillInput = {
  payMonth: string;
  department: string;
  budgetActivityId: number;
};

/**
 * Posts a finalized pay bill as one combined Draft payroll voucher:
 * gross pay is charged to the chosen budget activity, salary tax, health
 * contribution and advances are recognised as recoveries, and net pay is the
 * bank movement.
 */
export async function postPayBill(user: SessionUser, fiscalYear: string, input: PostPayBillInput): Promise<void> {
  const department = input.department.trim().normalize("NFC");

  if (await isAccountingMonthClosed(fiscalYear, input.payMonth)) {
    throw conflict("A pay bill cannot be posted to a closed accounting month.");
  }

  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.fiscalYear, fiscalYear),
          eq(payrollRuns.payMonth, input.payMonth),
          eq(payrollRuns.department, department),
        ),
      )
      .for("update")
      .limit(1);

    if (!run) throw conflict("Finalize the selected department's pay bill before posting it.");
    if (run.status !== "Finalized") throw conflict("This pay bill has already been posted to the Voucher module.");
    if (run.grossPayNu !== run.recoveriesNu + run.netPayNu) {
      throw conflict("The finalized pay bill is out of balance and cannot be posted.");
    }

    const balances = await loadActivityBalances(tx, fiscalYear, [input.budgetActivityId], true);
    const activity = balances.get(input.budgetActivityId);
    if (!activity) throw conflict("The selected approved budget activity is not available in this financial year.");

    if (run.grossPayNu > activity.availableNu) {
      throw conflict(
        "The department pay bill cannot be posted because Gross Pay is greater than the budget activity's available balance.",
        { availableBalanceNu: activity.availableNu, expenditureAmountNu: run.grossPayNu },
      );
    }

    const monthKey = input.payMonth.slice(5, 7);
    const serial = await nextVoucherSerial(tx, fiscalYear, "Payment", monthKey);
    const voucherNumber = formatVoucherNumber("Payment", Number(monthKey), serial);
    const reference = payBillReference(input.payMonth, department);

    const [voucher] = await tx
      .insert(vouchers)
      .values({
        voucherNumber,
        activityId: input.budgetActivityId,
        fiscalYear,
        voucherType: "Payment",
        payee: `${department} Employees`,
        billReference: reference,
        description: `Combined payroll payment for ${department} · ${input.payMonth} (${run.employeeCount} employees)`,
        amountNu: run.grossPayNu,
        gstNu: 0,
        tdsRate: 0,
        tdsNu: run.taxOnSalaryNu,
        advanceRecoveryNu: run.advanceNu,
        advanceRecoveryVoucherId: null,
        netPaymentNu: run.netPayNu,
        payrollRunId: run.id,
        payrollEntryType: "combined",
        payrollHealthContributionNu: run.healthContributionNu,
        status: "Draft",
        transactionDate: monthEndDate(input.payMonth),
        createdBy: user.id,
      })
      .returning({ id: vouchers.id });

    await tx.insert(voucherBudgetLines).values({
      voucherId: voucher.id,
      activityId: input.budgetActivityId,
      amountNu: run.grossPayNu,
    });

    await tx
      .update(payrollRuns)
      .set({
        budgetActivityId: input.budgetActivityId,
        status: "Posted",
        postedBy: user.id,
        postedAt: new Date(),
        postingUndoneAt: null,
      })
      .where(eq(payrollRuns.id, run.id));

    await audit(
      user.id,
      "pay_bill_posted",
      "payroll_run",
      run.id,
      `${reference} · ${activity.obc} ${activity.activity}: combined payroll voucher ${voucherNumber}`,
      tx,
    );
  });
}

/**
 * Returns a posted pay bill to Finalized.
 *
 * Draft, Pending and Rejected generated vouchers are removed; Reversed ones are
 * kept and detached so the accounting history survives. An Approved or Paid
 * voucher blocks the undo entirely — it must be reversed first.
 */
export async function undoPayBillPosting(
  user: SessionUser,
  fiscalYear: string,
  payMonth: string,
  departmentName: string,
): Promise<void> {
  const department = departmentName.trim().normalize("NFC");

  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: payrollRuns.id, status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.fiscalYear, fiscalYear),
          eq(payrollRuns.payMonth, payMonth),
          eq(payrollRuns.department, department),
        ),
      )
      .for("update")
      .limit(1);

    if (!run) throw notFound("The selected pay bill was not found.");
    if (run.status !== "Posted") throw conflict("Only a posted pay bill can have its posting undone.");

    const [state] = (await tx.execute<{ voucherCount: number; reversedCount: number; protectedCount: number }>(raw`
      SELECT
        COUNT(*) AS "voucherCount",
        COALESCE(SUM(CASE WHEN status = 'Reversed' THEN 1 ELSE 0 END), 0) AS "reversedCount",
        COALESCE(SUM(CASE WHEN status IN ('Draft','Pending','Rejected','Reversed') THEN 0 ELSE 1 END), 0) AS "protectedCount"
      FROM vouchers WHERE payroll_run_id = ${run.id}
    `)) as unknown as { voucherCount: number; reversedCount: number; protectedCount: number }[];

    if ((state?.protectedCount ?? 0) > 0) {
      throw conflict(
        "Pay Bill Posting cannot be undone while a generated voucher is approved or paid. Reverse the approved payroll vouchers first so their accounting history is preserved.",
      );
    }

    const removedCount = await deleteUnapprovedPayrollVouchers(tx, run.id);

    await tx
      .update(vouchers)
      .set({ payrollRunId: null })
      .where(and(eq(vouchers.payrollRunId, run.id), eq(vouchers.status, "Reversed")));

    const updated = await tx
      .update(payrollRuns)
      .set({
        budgetActivityId: null,
        status: "Finalized",
        postedBy: null,
        postedAt: null,
        postingUndoneAt: new Date(),
      })
      .where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.status, "Posted")))
      .returning({ id: payrollRuns.id });

    if (!updated.length) throw conflict("The pay bill posting has already been changed. Refresh and try again.");

    await audit(
      user.id,
      "pay_bill_posting_undone",
      "payroll_run",
      run.id,
      `${payMonth} · ${department}: removed ${removedCount} unapproved generated vouchers, preserved ${state?.reversedCount ?? 0} reversed vouchers and returned the pay bill to Finalized`,
      tx,
    );
  });
}

/** Deletes the locked snapshot so the department can be reviewed afresh. */
export async function unfinalizePayBill(
  user: SessionUser,
  fiscalYear: string,
  payMonth: string,
  departmentName: string,
): Promise<void> {
  const department = departmentName.trim().normalize("NFC");

  await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ id: payrollRuns.id, status: payrollRuns.status, postingUndoneAt: payrollRuns.postingUndoneAt })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.fiscalYear, fiscalYear),
          eq(payrollRuns.payMonth, payMonth),
          eq(payrollRuns.department, department),
        ),
      )
      .for("update")
      .limit(1);

    if (!run) throw notFound("The selected pay bill was not found.");
    if (run.status === "Posted") throw conflict("Undo Pay Bill Posting before un-finalizing the pay bill.");
    if (run.status !== "Finalized" || !run.postingUndoneAt) {
      throw conflict("A pay bill can be un-finalized only after its Pay Bill Posting has been undone.");
    }

    const [voucherCount] = (await tx.execute<{ count: number }>(raw`
      SELECT COUNT(*) AS "count" FROM vouchers WHERE payroll_run_id = ${run.id}
    `)) as unknown as { count: number }[];
    if ((voucherCount?.count ?? 0) > 0) {
      throw conflict("Generated vouchers still exist for this pay bill. Undo Pay Bill Posting first.");
    }

    await tx.delete(payrollRunItems).where(eq(payrollRunItems.payrollRunId, run.id));
    const deleted = await tx.delete(payrollRuns).where(eq(payrollRuns.id, run.id)).returning({ id: payrollRuns.id });

    if (!deleted.length) throw conflict("The pay bill finalization has already been changed. Refresh and try again.");

    await audit(
      user.id,
      "pay_bill_unfinalized",
      "payroll_run",
      run.id,
      `${payMonth} · ${department}: posting was undone first, then the finalized payroll snapshot was removed for fresh review`,
      tx,
    );
  });
}
