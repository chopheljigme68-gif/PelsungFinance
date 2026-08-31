/**
 * Role-based access control.
 *
 * Mirrored in `backend/src/domain/permissions.ts`, which is authoritative:
 * this copy only decides which menus and buttons are shown. Every mutation is
 * re-checked server-side regardless of what the UI allowed.
 */

export const APP_ROLES = ["agency_user", "agency_admin", "approving_authority", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const roleLabels: Record<AppRole, string> = {
  agency_user: "User",
  agency_admin: "Admin",
  approving_authority: "Approving Authority",
  viewer: "Viewer",
};

export const PERMISSIONS = [
  "create_voucher",
  "record_fund_receipt",
  "approve_voucher",
  "view_budget",
  "view_reports",
  "view_payroll",
  "manage_payroll",
  "add_employee",
  "manage_budget",
  "reappropriate_budget",
  "supplementary_budget",
  "manage_users",
  "assign_roles",
  "manage_departments",
  "undo_payroll",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const rolePermissions: Record<AppRole, Permission[]> = {
  agency_user: ["create_voucher", "view_reports", "view_payroll", "manage_payroll", "add_employee"],
  agency_admin: [
    "create_voucher",
    "record_fund_receipt",
    "approve_voucher",
    "view_budget",
    "view_reports",
    "view_payroll",
    "manage_payroll",
    "add_employee",
    "manage_budget",
    "reappropriate_budget",
    "supplementary_budget",
    "manage_users",
    "assign_roles",
    "manage_departments",
    "undo_payroll",
  ],
  approving_authority: [
    "record_fund_receipt",
    "approve_voucher",
    "view_budget",
    "view_reports",
    "view_payroll",
    "manage_payroll",
    "add_employee",
    "reappropriate_budget",
    "supplementary_budget",
    "undo_payroll",
  ],
  viewer: ["view_budget", "view_reports", "view_payroll"],
};

export const assignableRoles: AppRole[] = [...APP_ROLES];

export function isAppRole(value: unknown): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}

export function can(role: AppRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}

export const roleDescriptions: Record<AppRole, string> = {
  agency_user: "Prepare vouchers · View reports · Add payroll employees",
  agency_admin:
    "Add, supplement and re-appropriate budget activities · Prepare and approve vouchers · Record fund receipts · Manage users and departments · Payroll · Reports",
  approving_authority:
    "Approve vouchers · Record fund receipts · Manage employees and payroll · View reports · Supplement and re-appropriate budgets",
  viewer: "Read-only Dashboard · Budget Activities · Payroll · Reports",
};
