/**
 * Bhutan monthly payroll withholding.
 *
 * Source: Rules on the Income Tax Act of Bhutan 2025, Rule 153 and Annexure I,
 * effective 1 January 2026. Pelsung operates no Provident Fund, so the PF rate
 * is zero; the 15% specific deduction applies to gross salary and the residue
 * is the TDS basis to which the Annexure I table applies.
 *
 * This module is byte-for-byte equivalent to the frontend copy in
 * `backend/src/domain/payroll-tax.ts`. Keep the two in sync — the backend value
 * is always authoritative and the frontend copy exists only for live previews.
 */

export const BHUTAN_PAYROLL_TAX_RULE = {
  title: "Rules on the Income Tax Act of Bhutan 2025",
  reference: "Rule 153 and Annexure I",
  effectiveFrom: "2026-01-01",
  providentFundRate: 0,
  specificDeductionRate: 0.15,
} as const;

export const HEALTH_CONTRIBUTION_RATE = 0.01;

type TaxBand = { ceilingNu: number; rate: number };

/** Annexure I is the monthly equivalent of these annual progressive bands. */
const annualTaxBands: TaxBand[] = [
  { ceilingNu: 300_000, rate: 0 },
  { ceilingNu: 500_000, rate: 0.05 },
  { ceilingNu: 750_000, rate: 0.1 },
  { ceilingNu: 1_200_000, rate: 0.15 },
  { ceilingNu: 2_000_000, rate: 0.2 },
  { ceilingNu: 3_500_000, rate: 0.25 },
  { ceilingNu: Number.POSITIVE_INFINITY, rate: 0.3 },
];

export type BhutanMonthlyPayrollTax = {
  grossTaxableIncomeNu: number;
  providentFundNu: number;
  specificDeductionNu: number;
  tdsBasisNu: number;
  taxOnSalaryNu: number;
};

function roundCurrency(amountNu: number): number {
  return Math.round(amountNu * 100) / 100;
}

function progressiveMonthlyTax(slabMonthlyIncomeNu: number): number {
  const annualIncomeNu = slabMonthlyIncomeNu * 12;
  let lowerBoundNu = 0;
  let annualTaxNu = 0;

  for (const band of annualTaxBands) {
    const taxableInBandNu = Math.max(0, Math.min(annualIncomeNu, band.ceilingNu) - lowerBoundNu);
    annualTaxNu += taxableInBandNu * band.rate;
    if (annualIncomeNu <= band.ceilingNu) break;
    lowerBoundNu = band.ceilingNu;
  }

  return Math.round(annualTaxNu / 12);
}

/** Annexure I monthly TDS for a given monthly TDS basis. */
export function calculateAnnexureIMonthlyTds(monthlyTdsBasisNu: number): number {
  const tdsBasisNu = Math.max(0, Math.ceil(monthlyTdsBasisNu));
  if (tdsBasisNu <= 25_000) return 0;

  // Annexure I provides a separate continuation formula above its final
  // published table row of Nu. 323,100.
  if (tdsBasisNu > 323_100) {
    return Math.max(0, Math.round(53_108 + (tdsBasisNu - 291_600) * 0.3));
  }

  // Published Annexure I rows group income into Nu. 100 slabs and state the
  // TDS at the top of each slab.
  const slabMonthlyIncomeNu = Math.ceil(tdsBasisNu / 100) * 100;
  return progressiveMonthlyTax(slabMonthlyIncomeNu);
}

export function calculateBhutanMonthlyPayrollTax(grossTaxableIncomeNu: number): BhutanMonthlyPayrollTax {
  const normalizedGrossNu = Math.max(0, Math.round(grossTaxableIncomeNu));
  const providentFundNu = Math.round(normalizedGrossNu * BHUTAN_PAYROLL_TAX_RULE.providentFundRate);
  const specificDeductionNu = roundCurrency(normalizedGrossNu * BHUTAN_PAYROLL_TAX_RULE.specificDeductionRate);
  const tdsBasisNu = roundCurrency(normalizedGrossNu - specificDeductionNu);
  return {
    grossTaxableIncomeNu: normalizedGrossNu,
    providentFundNu,
    specificDeductionNu,
    tdsBasisNu,
    taxOnSalaryNu: calculateAnnexureIMonthlyTds(tdsBasisNu),
  };
}

/** Health Contribution is 1% of gross pay. */
export function calculateHealthContribution(grossPayNu: number): number {
  return Math.max(0, Math.round(grossPayNu * HEALTH_CONTRIBUTION_RATE));
}

/** Complete monthly payroll figures for one employee. */
export function calculateEmployeePayroll(input: {
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  advanceNu: number;
}) {
  const grossPayNu = input.basicPayNu + input.allowancesNu + input.arrearNu;
  const tax = calculateBhutanMonthlyPayrollTax(grossPayNu);
  const healthContributionNu = calculateHealthContribution(grossPayNu);
  const deductionsNu = tax.taxOnSalaryNu + healthContributionNu + input.advanceNu;
  return {
    ...tax,
    grossPayNu,
    healthContributionNu,
    deductionsNu,
    netPayNu: grossPayNu - deductionsNu,
  };
}
