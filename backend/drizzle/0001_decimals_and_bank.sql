-- 0001: money to 2 decimals, employee bank details.
-- Existing whole-Ngultrum values are preserved exactly (5000 -> 5000.00).

-- budget_activities
ALTER TABLE "budget_activities" ALTER COLUMN "approved_nu" TYPE numeric(14, 2);

-- budget_reappropriations
ALTER TABLE "budget_reappropriations" ALTER COLUMN "amount_nu" TYPE numeric(14, 2);

-- supplementary_budgets
ALTER TABLE "supplementary_budgets" ALTER COLUMN "amount_nu" TYPE numeric(14, 2);

-- employees
ALTER TABLE "employees" ALTER COLUMN "basic_pay_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "allowances_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "arrear_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "gross_pay_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "tax_on_salary_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "health_contribution_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "advance_nu" TYPE numeric(14, 2);
ALTER TABLE "employees" ALTER COLUMN "deductions_nu" TYPE numeric(14, 2);

-- payroll_runs
ALTER TABLE "payroll_runs" ALTER COLUMN "basic_pay_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "allowances_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "arrear_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "gross_pay_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "tax_on_salary_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "health_contribution_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "advance_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "recoveries_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_runs" ALTER COLUMN "net_pay_nu" TYPE numeric(14, 2);

-- payroll_run_items
ALTER TABLE "payroll_run_items" ALTER COLUMN "basic_pay_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "allowances_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "arrear_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "gross_pay_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "tax_on_salary_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "health_contribution_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "advance_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "recoveries_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_run_items" ALTER COLUMN "net_pay_nu" TYPE numeric(14, 2);

-- payroll_remittance_runs
ALTER TABLE "payroll_remittance_runs" ALTER COLUMN "tax_on_salary_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_remittance_runs" ALTER COLUMN "health_contribution_nu" TYPE numeric(14, 2);
ALTER TABLE "payroll_remittance_runs" ALTER COLUMN "total_remittance_nu" TYPE numeric(14, 2);

-- supplier_tds_remittance_runs
ALTER TABLE "supplier_tds_remittance_runs" ALTER COLUMN "total_remittance_nu" TYPE numeric(14, 2);

-- vouchers
ALTER TABLE "vouchers" ALTER COLUMN "amount_nu" TYPE numeric(14, 2);
ALTER TABLE "vouchers" ALTER COLUMN "gst_nu" TYPE numeric(14, 2);
ALTER TABLE "vouchers" ALTER COLUMN "tds_nu" TYPE numeric(14, 2);
ALTER TABLE "vouchers" ALTER COLUMN "advance_recovery_nu" TYPE numeric(14, 2);
ALTER TABLE "vouchers" ALTER COLUMN "net_payment_nu" TYPE numeric(14, 2);
ALTER TABLE "vouchers" ALTER COLUMN "payroll_health_contribution_nu" TYPE numeric(14, 2);

-- voucher_budget_lines
ALTER TABLE "voucher_budget_lines" ALTER COLUMN "amount_nu" TYPE numeric(14, 2);

-- supplier_tds_remittance_items
ALTER TABLE "supplier_tds_remittance_items" ALTER COLUMN "tds_nu" TYPE numeric(14, 2);

-- Employee bank details (for salary credit).
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "account_number" text;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "bank_name" text;