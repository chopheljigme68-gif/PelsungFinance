import { and, eq, sql as raw } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  payrollRemittanceRuns,
  supplierTdsRemittanceItems,
  supplierTdsRemittanceRuns,
  vouchers,
} from "../../db/schema.js";
import { monthEndDate, payrollRemittanceReference, supplierTdsReference } from "../../domain/fiscal-year.js";
import { formatVoucherNumber } from "../../domain/vouchers.js";
import { audit } from "../../lib/audit.js";
import { conflict } from "../../lib/errors.js";
import { nextVoucherSerial } from "../accounting/accounting.service.js";
import type { SessionUser } from "../auth/auth.service.js";

/* -------------------------------------------------------------------------- */
/* Salary TDS and Health Contribution remittance                              */
/* -------------------------------------------------------------------------- */

type PayrollRemittanceSource = {
  runCount: number;
  employeeCount: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  unpaidRunCount: number;
};

/**
 * Finalizes the monthly salary withholding remittance and generates its Draft
 * Payment Voucher in the same transaction.
 *
 * Every department pay bill for the month must be posted, and each generated
 * salary voucher approved, before the withheld amounts can be remitted.
 */
export async function finalizePayrollRemittance(
  user: SessionUser,
  fiscalYear: string,
  payMonth: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ status: payrollRemittanceRuns.status })
      .from(payrollRemittanceRuns)
      .where(and(eq(payrollRemittanceRuns.fiscalYear, fiscalYear), eq(payrollRemittanceRuns.payMonth, payMonth)))
      .limit(1);

    if (existing) {
      throw conflict(
        `The TDS and HC remittance for this month has already been ${existing.status.toLocaleLowerCase()}.`,
      );
    }

    const [source] = (await tx.execute<PayrollRemittanceSource>(raw`
      SELECT
        COUNT(*) AS "runCount",
        COALESCE(SUM(pr.employee_count), 0) AS "employeeCount",
        COALESCE(SUM(pr.tax_on_salary_nu), 0) AS "taxOnSalaryNu",
        COALESCE(SUM(pr.health_contribution_nu), 0) AS "healthContributionNu",
        COALESCE(SUM(CASE WHEN
          (SELECT COUNT(*) FROM vouchers v WHERE v.payroll_run_id = pr.id) IN (1, 3) AND
          (SELECT COUNT(*) FROM vouchers v WHERE v.payroll_run_id = pr.id AND v.status IN ('Approved','Paid')) =
            (SELECT COUNT(*) FROM vouchers v WHERE v.payroll_run_id = pr.id)
        THEN 0 ELSE 1 END), 0) AS "unpaidRunCount"
      FROM payroll_runs pr
      WHERE pr.fiscal_year = ${fiscalYear} AND pr.pay_month = ${payMonth} AND pr.status = 'Posted'
    `)) as unknown as PayrollRemittanceSource[];

    if (!(source?.runCount ?? 0)) {
      throw conflict("Post the department pay bills for this month before preparing the remittance.");
    }
    if ((source?.unpaidRunCount ?? 0) > 0) {
      throw conflict("Approve the generated salary voucher for every department before finalizing TDS and HC remittance.");
    }

    const taxOnSalaryNu = source.taxOnSalaryNu;
    const healthContributionNu = source.healthContributionNu;
    const totalRemittanceNu = taxOnSalaryNu + healthContributionNu;
    if (totalRemittanceNu <= 0) {
      throw conflict("The paid salary records do not contain TDS or Health Contribution to remit.");
    }

    const now = new Date();
    const [run] = await tx
      .insert(payrollRemittanceRuns)
      .values({
        fiscalYear,
        payMonth,
        employeeCount: source.employeeCount,
        taxOnSalaryNu,
        healthContributionNu,
        totalRemittanceNu,
        status: "Posted",
        finalizedBy: user.id,
        finalizedAt: now,
        postedBy: user.id,
        postedAt: now,
      })
      .returning({ id: payrollRemittanceRuns.id });

    const voucherNumber = await insertRemittanceVoucher(tx, {
      user,
      fiscalYear,
      payMonth,
      remittanceRunId: run.id,
      taxOnSalaryNu,
      healthContributionNu,
      totalRemittanceNu,
    });

    await audit(
      user.id,
      "payroll_remittance_finalized",
      "payroll_remittance",
      run.id,
      `${payMonth}: TDS Nu. ${taxOnSalaryNu}, HC Nu. ${healthContributionNu}, total Nu. ${totalRemittanceNu}; Draft voucher ${voucherNumber} generated automatically`,
      tx,
    );
    await audit(
      user.id,
      "payroll_remittance_posted",
      "payroll_remittance",
      run.id,
      `${payrollRemittanceReference(payMonth)}: ${voucherNumber}, Nu. ${totalRemittanceNu}, Draft awaiting submission`,
      tx,
    );
  });
}

/** Generates the voucher for a remittance finalized by an earlier release. */
export async function postPayrollRemittance(user: SessionUser, fiscalYear: string, payMonth: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [remittance] = await tx
      .select()
      .from(payrollRemittanceRuns)
      .where(and(eq(payrollRemittanceRuns.fiscalYear, fiscalYear), eq(payrollRemittanceRuns.payMonth, payMonth)))
      .for("update")
      .limit(1);

    if (!remittance || remittance.status !== "Finalized") {
      throw conflict("Finalize the selected TDS and HC remittance before posting it.");
    }

    const voucherNumber = await insertRemittanceVoucher(tx, {
      user,
      fiscalYear,
      payMonth,
      remittanceRunId: remittance.id,
      taxOnSalaryNu: remittance.taxOnSalaryNu,
      healthContributionNu: remittance.healthContributionNu,
      totalRemittanceNu: remittance.totalRemittanceNu,
    });

    await tx
      .update(payrollRemittanceRuns)
      .set({ status: "Posted", postedBy: user.id, postedAt: new Date() })
      .where(and(eq(payrollRemittanceRuns.id, remittance.id), eq(payrollRemittanceRuns.status, "Finalized")));

    await audit(
      user.id,
      "payroll_remittance_posted",
      "payroll_remittance",
      remittance.id,
      `${payrollRemittanceReference(payMonth)}: ${voucherNumber}, Nu. ${remittance.totalRemittanceNu}`,
      tx,
    );
  });
}

type RemittanceVoucherInput = {
  user: SessionUser;
  fiscalYear: string;
  payMonth: string;
  remittanceRunId: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  totalRemittanceNu: number;
};

async function insertRemittanceVoucher(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: RemittanceVoucherInput,
): Promise<string> {
  const monthKey = input.payMonth.slice(5, 7);
  const serial = await nextVoucherSerial(tx, input.fiscalYear, "Payment", monthKey);
  const voucherNumber = formatVoucherNumber("Payment", Number(monthKey), serial);

  await tx.insert(vouchers).values({
    voucherNumber,
    activityId: null,
    fiscalYear: input.fiscalYear,
    voucherType: "Payment",
    payee: "Department of Revenue and Customs",
    billReference: payrollRemittanceReference(input.payMonth),
    description: `Monthly salary TDS and Health Contribution remittance for ${input.payMonth} (TDS Nu. ${input.taxOnSalaryNu}; HC Nu. ${input.healthContributionNu})`,
    amountNu: input.totalRemittanceNu,
    gstNu: 0,
    tdsRate: 0,
    tdsNu: input.taxOnSalaryNu,
    advanceRecoveryNu: 0,
    advanceRecoveryVoucherId: null,
    netPaymentNu: input.totalRemittanceNu,
    payrollRemittanceRunId: input.remittanceRunId,
    payrollEntryType: "tds_hc_remittance",
    payrollHealthContributionNu: input.healthContributionNu,
    status: "Draft",
    transactionDate: monthEndDate(input.payMonth),
    createdBy: input.user.id,
  });

  return voucherNumber;
}

/* -------------------------------------------------------------------------- */
/* Supplier TDS remittance                                                    */
/* -------------------------------------------------------------------------- */

type SupplierTdsSource = { sourceVoucherCount: number; totalRemittanceNu: number };

/**
 * Schedules every approved, not-yet-remitted supplier TDS deduction of a month
 * at one rate into a single remittance and its Draft Payment Voucher.
 */
export async function finalizeSupplierTdsRemittance(
  user: SessionUser,
  fiscalYear: string,
  payMonth: string,
  tdsRate: 2 | 5,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: supplierTdsRemittanceRuns.id })
      .from(supplierTdsRemittanceRuns)
      .where(
        and(
          eq(supplierTdsRemittanceRuns.fiscalYear, fiscalYear),
          eq(supplierTdsRemittanceRuns.payMonth, payMonth),
          eq(supplierTdsRemittanceRuns.tdsRate, tdsRate),
          raw`${supplierTdsRemittanceRuns.status} <> 'Reversed'`,
        ),
      )
      .limit(1);

    if (existing) throw conflict(`The ${tdsRate}% TDS Remittance for ${payMonth} has already been generated.`);

    // Eligible = approved supplier payment vouchers in the month, at this rate,
    // with TDS withheld and not already inside a live remittance.
    const eligibleVouchers = (await tx.execute<{ id: number; tdsNu: number }>(raw`
      SELECT v.id, v.tds_nu AS "tdsNu"
      FROM vouchers v
      WHERE v.fiscal_year = ${fiscalYear}
        AND substr(v.transaction_date, 1, 7) = ${payMonth}
        AND v.voucher_type = 'Payment'
        AND v.payroll_entry_type IS NULL
        AND v.tds_rate = ${tdsRate}
        AND v.tds_nu > 0
        AND v.status IN ('Approved','Paid')
        AND NOT EXISTS (
          SELECT 1 FROM supplier_tds_remittance_items existing_item
          JOIN supplier_tds_remittance_runs existing_run ON existing_run.id = existing_item.remittance_run_id
          WHERE existing_item.voucher_id = v.id AND existing_run.status <> 'Reversed'
        )
      ORDER BY v.id
      FOR UPDATE OF v
    `)) as unknown as { id: number; tdsNu: number }[];

    const source: SupplierTdsSource = {
      sourceVoucherCount: eligibleVouchers.length,
      totalRemittanceNu: eligibleVouchers.reduce((sum, voucher) => sum + voucher.tdsNu, 0),
    };

    if (!source.sourceVoucherCount || source.totalRemittanceNu <= 0) {
      throw conflict(`There are no approved, unremitted ${tdsRate}% supplier TDS deductions for the selected month.`);
    }

    const [run] = await tx
      .insert(supplierTdsRemittanceRuns)
      .values({
        fiscalYear,
        payMonth,
        tdsRate,
        sourceVoucherCount: source.sourceVoucherCount,
        totalRemittanceNu: source.totalRemittanceNu,
        status: "Posted",
        finalizedBy: user.id,
        finalizedAt: new Date(),
      })
      .returning({ id: supplierTdsRemittanceRuns.id });

    await tx.insert(supplierTdsRemittanceItems).values(
      eligibleVouchers.map((voucher) => ({ remittanceRunId: run.id, voucherId: voucher.id, tdsNu: voucher.tdsNu })),
    );

    const monthKey = payMonth.slice(5, 7);
    const serial = await nextVoucherSerial(tx, fiscalYear, "Payment", monthKey);
    const voucherNumber = formatVoucherNumber("Payment", Number(monthKey), serial);
    const reference = supplierTdsReference(payMonth, tdsRate);

    await tx.insert(vouchers).values({
      voucherNumber,
      activityId: null,
      fiscalYear,
      voucherType: "Payment",
      payee: "Department of Revenue and Customs",
      billReference: reference,
      description: `${tdsRate}% TDS Remittance for ${payMonth} from ${source.sourceVoucherCount} approved voucher${source.sourceVoucherCount === 1 ? "" : "s"}`,
      amountNu: source.totalRemittanceNu,
      gstNu: 0,
      tdsRate: 0,
      tdsNu: 0,
      advanceRecoveryNu: 0,
      advanceRecoveryVoucherId: null,
      netPaymentNu: source.totalRemittanceNu,
      supplierTdsRemittanceRunId: run.id,
      payrollEntryType: "supplier_tds_remittance",
      payrollHealthContributionNu: 0,
      status: "Draft",
      transactionDate: monthEndDate(payMonth),
      createdBy: user.id,
    });

    await audit(
      user.id,
      "supplier_tds_remittance_generated",
      "supplier_tds_remittance",
      run.id,
      `${reference}: ${source.sourceVoucherCount} approved supplier vouchers, Nu. ${source.totalRemittanceNu}; Draft voucher ${voucherNumber}`,
      tx,
    );
  });
}
