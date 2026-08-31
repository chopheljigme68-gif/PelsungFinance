import type { AppRole } from "@/types";

export type NavigationItem = { label: string; href: string; icon: string };
export type NavigationGroup = { title: string; items: NavigationItem[] };

const item = {
  dashboard: { label: "Dashboard", href: "/dashboard", icon: "⌂" },
  budget: { label: "Budget Activities", href: "/budget", icon: "▤" },
  vouchers: { label: "Vouchers", href: "/vouchers", icon: "◫" },
  tds: { label: "TDS Remittance", href: "/tds-remittance", icon: "%" },
  payroll: { label: "Payroll", href: "/payroll", icon: "Nu" },
  approvals: { label: "Approval Queue", href: "/approvals", icon: "✓" },
  ledger: { label: "General Ledger", href: "/ledger", icon: "≡" },
  reports: { label: "Reports", href: "/reports", icon: "◔" },
  users: { label: "User Management", href: "/users", icon: "◇" },
} as const satisfies Record<string, NavigationItem>;

/** The menu each role sees; routes are also guarded by permission. */
export function navigationFor(role: AppRole): NavigationGroup[] {
  if (role === "viewer") {
    return [
      { title: "Workspace", items: [item.dashboard] },
      { title: "Read-only access", items: [item.budget, item.payroll, item.reports] },
    ];
  }
  if (role === "agency_user") {
    return [
      { title: "Workspace", items: [item.dashboard] },
      { title: "Agency operations", items: [item.vouchers, item.tds, item.payroll, item.reports] },
    ];
  }
  if (role === "approving_authority") {
    return [
      { title: "Workspace", items: [item.dashboard] },
      { title: "Approval control", items: [item.approvals, item.vouchers, item.budget, item.payroll, item.reports] },
    ];
  }
  return [
    { title: "Workspace", items: [item.dashboard] },
    { title: "Agency operations", items: [item.budget, item.vouchers, item.tds, item.payroll, item.ledger] },
    { title: "Control & reports", items: [item.approvals, item.reports, item.users] },
  ];
}

/** Breadcrumb/title for a pathname. */
export function routeTitle(pathname: string): string {
  const match = Object.values(item).find((entry) => pathname.startsWith(entry.href));
  return match?.label ?? "Dashboard";
}
