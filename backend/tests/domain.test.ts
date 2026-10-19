import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FISCAL_YEAR,
  fiscalYearEndDate,
  fiscalYearMonths,
  fiscalYearStartDate,
  isPayMonthInFiscalYear,
  monthEndDate,
  normalizeFiscalYear,
  payBillReference,
  supplierTdsReference,
} from "../src/domain/fiscal-year.js";
import {
  calculateAnnexureIMonthlyTds,
  calculateBhutanMonthlyPayrollTax,
  calculateEmployeePayroll,
  calculateHealthContribution,
} from "../src/domain/payroll-tax.js";
import { can, rolePermissions } from "../src/domain/permissions.js";
import {
  budgetLineSign,
  calculateVoucherDeductions,
  formatVoucherNumber,
  highestVoucherSerial,
  receiptCreditsBudget,
  voucherBankEffectNu,
  voucherCashEffectNu,
} from "../src/domain/vouchers.js";

describe("Bhutan payroll tax — Rule 153 and Annexure I", () => {
  it("charges no TDS below the Nu. 25,000 monthly basis", () => {
    assert.equal(calculateAnnexureIMonthlyTds(0), 0);
    assert.equal(calculateAnnexureIMonthlyTds(25_000), 0);
  });

  it("starts charging just above the threshold", () => {
    assert.ok(calculateAnnexureIMonthlyTds(25_100) > 0);
  });

  it("applies the 15% specific deduction before the table", () => {
    const tax = calculateBhutanMonthlyPayrollTax(70_000);
    assert.equal(tax.specificDeductionNu, 10_500);
    assert.equal(tax.tdsBasisNu, 59_500);
    assert.equal(tax.providentFundNu, 0);
  });

  it("uses the continuation formula above the published table", () => {
    // Annexure I's last row ends at Nu. 323,100.
    const expected = Math.round(53_108 + (400_000 - 291_600) * 0.3);
    assert.equal(calculateAnnexureIMonthlyTds(400_000), expected);
  });

  it("increases monotonically with income", () => {
    let previous = -1;
    for (let basis = 0; basis <= 500_000; basis += 2_500) {
      const tax = calculateAnnexureIMonthlyTds(basis);
      assert.ok(tax >= previous, `TDS fell at basis ${basis}`);
      previous = tax;
    }
  });

  it("never charges more tax than the basis", () => {
    for (const basis of [30_000, 120_000, 250_000, 323_100, 1_000_000]) {
      assert.ok(calculateAnnexureIMonthlyTds(basis) < basis);
    }
  });

  it("computes health contribution at 1% of gross", () => {
    assert.equal(calculateHealthContribution(70_000), 700);
    assert.equal(calculateHealthContribution(0), 0);
    assert.equal(calculateHealthContribution(70_050), 701);
  });

  it("builds a complete employee payroll line", () => {
    const payroll = calculateEmployeePayroll({
      basicPayNu: 60_000,
      allowancesNu: 10_000,
      arrearNu: 0,
      advanceNu: 2_000,
    });
    assert.equal(payroll.grossPayNu, 70_000);
    assert.equal(payroll.healthContributionNu, 700);
    assert.equal(payroll.deductionsNu, payroll.taxOnSalaryNu + 700 + 2_000);
    assert.equal(payroll.netPayNu, payroll.grossPayNu - payroll.deductionsNu);
  });
});

describe("Voucher arithmetic", () => {
  it("charges TDS on gross less GST", () => {
    const result = calculateVoucherDeductions(110_000, 10_000, 2, 0);
    assert.equal(result.tdsBasisNu, 100_000);
    assert.equal(result.tdsNu, 2_000);
    assert.equal(result.netPaymentNu, 108_000);
  });

  it("deducts an advance recovery from the net payment", () => {
    const result = calculateVoucherDeductions(60_000, 0, 0, 20_000);
    assert.equal(result.tdsNu, 0);
    assert.equal(result.netPaymentNu, 40_000);
  });

  it("never produces a negative TDS basis", () => {
    const result = calculateVoucherDeductions(1_000, 5_000, 5, 0);
    assert.equal(result.tdsBasisNu, 0);
    assert.equal(result.tdsNu, 0);
  });

  it("moves the bank by type: receipts in, payments net, advances gross", () => {
    assert.equal(voucherBankEffectNu({ voucherType: "Receipt", amountNu: 5_000, netPaymentNu: 5_000 }), 5_000);
    assert.equal(voucherBankEffectNu({ voucherType: "Payment", amountNu: 110_000, netPaymentNu: 108_000 }), -108_000);
    assert.equal(voucherBankEffectNu({ voucherType: "Advance", amountNu: 50_000, netPaymentNu: 50_000 }), -50_000);
    assert.equal(voucherBankEffectNu({ voucherType: "Journal", amountNu: 9_000, netPaymentNu: 9_000 }), 0);
  });

  it("routes receipts by ledger and keeps direct transactions off the bank", () => {
    const receipt = { voucherType: "Receipt", amountNu: 2_500, netPaymentNu: 2_500 };
    assert.equal(voucherBankEffectNu({ ...receipt, ledgerCode: "1001" }), 2_500);
    assert.equal(voucherCashEffectNu({ ...receipt, ledgerCode: "1001" }), 0);
    assert.equal(voucherBankEffectNu({ ...receipt, ledgerCode: "1002" }), 0);
    assert.equal(voucherCashEffectNu({ ...receipt, ledgerCode: "1002" }), 2_500);
    assert.equal(voucherBankEffectNu({ voucherType: "DT", amountNu: 7_000, netPaymentNu: 7_000, ledgerCode: "1001" }), 0);
    assert.equal(voucherCashEffectNu({ voucherType: "DT", amountNu: 7_000, netPaymentNu: 7_000, ledgerCode: "1001" }), 0);
  });

  it("signs budget lines: spending adds, refunds give back, advances never touch", () => {
    assert.equal(budgetLineSign("Payment"), 1);
    assert.equal(budgetLineSign("Journal"), 1);
    assert.equal(budgetLineSign("DT"), 1);
    assert.equal(budgetLineSign("Receipt"), -1);
    assert.equal(budgetLineSign("Advance"), 0);
    assert.equal(receiptCreditsBudget("Refund"), true);
    assert.equal(receiptCreditsBudget("Fund receipt"), false);
    assert.equal(receiptCreditsBudget("Other receipt"), false);
  });

  it("formats and reads voucher numbers", () => {
    assert.equal(formatVoucherNumber("Payment", 7, 3), "PV.7.03");
    assert.equal(formatVoucherNumber("Receipt", 12, 11), "RV.12.11");
    assert.equal(formatVoucherNumber("Advance", 1, 1), "AV.1.01");
    assert.equal(formatVoucherNumber("Journal", 9, 2), "JV.9.02");
    assert.equal(formatVoucherNumber("DT", 8, 4), "DT.8.04");
    assert.equal(highestVoucherSerial(["PV.7.01", "PV.7.09", "PV.7.04"]), 9);
    assert.equal(highestVoucherSerial([]), 0);
  });
});

describe("Fiscal year", () => {
  it("accepts only consecutive-year pairs", () => {
    assert.equal(normalizeFiscalYear("2027-2028"), "2027-2028");
    assert.equal(normalizeFiscalYear("2026-2028"), DEFAULT_FISCAL_YEAR);
    assert.equal(normalizeFiscalYear("nonsense"), DEFAULT_FISCAL_YEAR);
    assert.equal(normalizeFiscalYear(undefined), DEFAULT_FISCAL_YEAR);
  });

  it("runs July to June", () => {
    const months = fiscalYearMonths("2026-2027");
    assert.equal(months.length, 12);
    assert.equal(months[0], "2026-07");
    assert.equal(months[11], "2027-06");
    assert.equal(fiscalYearStartDate("2026-2027"), "2026-07-01");
    assert.equal(fiscalYearEndDate("2026-2027"), "2027-06-30");
    assert.ok(isPayMonthInFiscalYear("2027-03", "2026-2027"));
    assert.ok(!isPayMonthInFiscalYear("2026-06", "2026-2027"));
  });

  it("resolves month ends, including February in a leap year", () => {
    assert.equal(monthEndDate("2026-07"), "2026-07-31");
    assert.equal(monthEndDate("2027-02"), "2027-02-28");
    assert.equal(monthEndDate("2028-02"), "2028-02-29");
  });

  it("builds readable references", () => {
    assert.equal(payBillReference("2026-07", "Finance and Accounts"), "PB-JUL-2026-FAA");
    assert.equal(supplierTdsReference("2026-11", 5), "SUP-TDS-5-NOV-2026");
  });
});

describe("Role permissions", () => {
  it("keeps the viewer read-only", () => {
    assert.deepEqual(rolePermissions.viewer, ["view_budget", "view_reports", "view_payroll"]);
    assert.ok(!can("viewer", "create_voucher"));
    assert.ok(!can("viewer", "approve_voucher"));
  });

  it("separates preparation from approval for the ordinary user", () => {
    assert.ok(can("agency_user", "create_voucher"));
    assert.ok(!can("agency_user", "approve_voucher"));
    assert.ok(!can("agency_user", "manage_budget"));
    assert.ok(!can("agency_user", "manage_users"));
  });

  it("gives the approving authority approval but not budget creation", () => {
    assert.ok(can("approving_authority", "approve_voucher"));
    assert.ok(can("approving_authority", "undo_payroll"));
    assert.ok(!can("approving_authority", "manage_budget"));
    assert.ok(!can("approving_authority", "manage_users"));
  });

  it("gives the admin every permission", () => {
    for (const permission of rolePermissions.agency_admin) {
      assert.ok(can("agency_admin", permission));
    }
    assert.ok(can("agency_admin", "manage_users"));
  });
});
