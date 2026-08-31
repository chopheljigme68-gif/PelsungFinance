/**
 * The API contract, mirrored from the backend's accounting types.
 * Keep in step with `backend/src/modules/accounting/accounting.types.ts`.
 */

export type AppRole = "agency_user" | "agency_admin" | "approving_authority" | "viewer";

export type Permission =
  | "create_voucher"
  | "record_fund_receipt"
  | "approve_voucher"
  | "view_budget"
  | "view_reports"
  | "view_payroll"
  | "manage_payroll"
  | "add_employee"
  | "manage_budget"
  | "reappropriate_budget"
  | "supplementary_budget"
  | "manage_users"
  | "assign_roles"
  | "manage_departments"
  | "undo_payroll";

export type AppUser = {
  id: number;
  username: string;
  displayName: string;
  designation: string;
  role: AppRole;
  roleLabel: string;
  permissions: Permission[];
  mustChangePassword: boolean;
};

export type PasswordPolicy = {
  minimumLength: number;
  maximumLength: number;
  unicodeAllowed: boolean;
  spacesAllowed: boolean;
  requiresUppercase: boolean;
  requiresSpecialCharacter: boolean;
};

export type Activity = {
  id: number;
  fiscalYear: string;
  category: string;
  financing: string;
  obc: string;
  activity: string;
  budgetType: "Current" | "Capital";
  approvedNu: number;
  utilizedNu: number;
  committedNu: number;
  brief: string;
};

export type BudgetReappropriation = {
  id: number;
  fiscalYear: string;
  sourceActivityId: number;
  sourceObc: string;
  sourceActivity: string;
  destinationActivityId: number;
  destinationObc: string;
  destinationActivity: string;
  amountNu: number;
  reason: string;
  transferredBy: number;
  transferredByName: string | null;
  transferredAt: string;
};

export type SupplementaryBudget = {
  id: number;
  fiscalYear: string;
  activityId: number;
  obc: string;
  activity: string;
  category: string;
  amountNu: number;
  reason: string;
  grantedBy: number;
  grantedByName: string | null;
  grantedAt: string;
};

export type VoucherBudgetLine = {
  id: number;
  voucherId: number;
  activityId: number;
  amountNu: number;
  obc: string;
  activity: string;
  category: string;
  financing: string;
  budgetType: "Current" | "Capital";
  approvedNu: number;
};

export type VoucherStatus = "Draft" | "Pending" | "Approved" | "Paid" | "Rejected" | "Reversed";

export type PayrollEntryType =
  | "gross"
  | "recoveries"
  | "net"
  | "combined"
  | "tds_hc_remittance"
  | "supplier_tds_remittance";

export type Voucher = {
  id: number;
  voucherNumber: string;
  activityId: number | null;
  fiscalYear: string;
  voucherType: string;
  payee: string;
  tpn?: string | null;
  billReference?: string | null;
  description: string;
  amountNu: number;
  gstNu: number;
  tdsRate: number;
  tdsNu: number;
  advanceRecoveryNu: number;
  advanceRecoveryVoucherId: number | null;
  advanceRecoveryVoucherNumber?: string | null;
  netPaymentNu: number;
  payrollRunId: number | null;
  payrollRemittanceRunId: number | null;
  supplierTdsRemittanceRunId: number | null;
  payrollEntryType: PayrollEntryType | null;
  payrollHealthContributionNu: number;
  supplierTdsRate: number;
  supplierTdsRemitted: boolean;
  supplierTdsRemittanceVoucherNumber?: string | null;
  supplierTdsSourceVoucherNumbers?: string | null;
  status: VoucherStatus;
  transactionDate: string;
  activity: string;
  obc: string;
  category: string;
  createdAt?: string | null;
  createdBy?: number | null;
  createdByName?: string | null;
  createdByCid?: string | null;
  createdByDesignation?: string | null;
  approvedBy?: number | null;
  approvedAt?: string | null;
  approvedByName?: string | null;
  approvedByCid?: string | null;
  approvedByDesignation?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
  reversedByName?: string | null;
  budgetLines: VoucherBudgetLine[];
};

export type Department = {
  id: number;
  name: string;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  employeeCount: number;
};

export type Employee = {
  id: number;
  employeeNumber: string;
  cid: string | null;
  tpn: string | null;
  email: string | null;
  fullName: string;
  designation: string;
  department: string;
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  grossPayNu: number;
  grossTaxableIncomeNu: number;
  providentFundNu: number;
  specificDeductionNu: number;
  tdsBasisNu: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  advanceNu: number;
  deductionsNu: number;
  status: "Active" | "Inactive";
  createdAt: string;
};

export type PayrollRun = {
  id: number;
  fiscalYear: string;
  payMonth: string;
  department: string;
  budgetActivityId: number | null;
  budgetActivityObc: string | null;
  budgetActivityName: string | null;
  budgetActivityFinancing: string | null;
  budgetActivityAvailableNu: number | null;
  employeeCount: number;
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  grossPayNu: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  advanceNu: number;
  recoveriesNu: number;
  netPayNu: number;
  status: "Finalized" | "Posted";
  finalizedBy: number;
  finalizedAt: string;
  finalizedByName: string | null;
  postedBy: number | null;
  postedAt: string | null;
  postedByName: string | null;
  postingUndoneAt: string | null;
  voucherNumbers: string | null;
  voucherCount: number;
  approvedVoucherCount: number;
};

export type PayrollRunItem = {
  id: number;
  payrollRunId: number;
  employeeId: number;
  employeeNumber: string;
  cid: string | null;
  tpn: string | null;
  email: string | null;
  fullName: string;
  designation: string;
  department: string;
  basicPayNu: number;
  allowancesNu: number;
  arrearNu: number;
  grossPayNu: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  advanceNu: number;
  deductionsNu: number;
  netPayNu: number;
  payslipEmailId: string | null;
  payslipSentAt: string | null;
};

export type PayrollRemittanceRun = {
  id: number;
  fiscalYear: string;
  payMonth: string;
  employeeCount: number;
  taxOnSalaryNu: number;
  healthContributionNu: number;
  totalRemittanceNu: number;
  status: "Finalized" | "Posted";
  finalizedByName: string | null;
  voucherNumbers: string | null;
};

export type SupplierTdsRemittanceRun = {
  id: number;
  fiscalYear: string;
  payMonth: string;
  tdsRate: 2 | 5;
  sourceVoucherCount: number;
  totalRemittanceNu: number;
  status: "Posted" | "Reversed";
  finalizedByName: string | null;
  voucherNumber: string | null;
  voucherStatus: VoucherStatus | null;
};

export type ManagedUser = {
  id: number;
  username: string;
  cid: string | null;
  displayName: string;
  designation: string;
  role: AppRole;
  roleLabel: string;
  mustChangePassword: boolean;
  active: boolean;
  lastLoginAt: string | null;
  invitationSentAt: string | null;
  deletedAt: string | null;
  deletedBy: number | null;
  createdAt: string;
};

export type PayrollTaxRule = {
  title: string;
  reference: string;
  effectiveFrom: string;
  providentFundRate: number;
  specificDeductionRate: number;
};

export type PayslipDelivery = { sent: number; failed: number; skipped: number };

export type AccountingData = {
  activities: Activity[];
  vouchers: Voucher[];
  employees: Employee[];
  departments: Department[];
  payrollRuns: PayrollRun[];
  payrollRunItems: PayrollRunItem[];
  payrollRemittanceRuns: PayrollRemittanceRun[];
  supplierTdsRemittanceRuns: SupplierTdsRemittanceRun[];
  budgetReappropriations: BudgetReappropriation[];
  supplementaryBudgets: SupplementaryBudget[];
  users: ManagedUser[];
  currentUser: AppUser;
  fiscalYear: string;
  fiscalYears: string[];
  payrollTaxRule: PayrollTaxRule;
  generatedAt: string;
  payrollPayslipDelivery?: PayslipDelivery;
  actionNotice?: string;
};
