import type { IconName } from "@/components/ui/nav-icons";
import type { AppRole } from "@/types";

/**
 * `match` lists extra path prefixes that should keep a hub item highlighted.
 * The Accounts and Process entries are hubs: their sub-screens (Vouchers, Bank
 * Reconciliation, Month Close) keep their own routes, so the hub stays active
 * while the user is inside one of them.
 */
export type NavigationItem = { label: string; href: string; icon: IconName; match?: string[] };
export type NavigationGroup = { title: string; items: NavigationItem[] };

/**
 * The full route registry — every screen, hub or not. The sidebar shows the
 * hub entries (Accounts, Process); `routeTitle` still resolves the real screen
 * (Vouchers, Bank Reconciliation, Month Close) so the top bar reads correctly.
 */
const item = {
  dashboard: { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  budget: { label: "Budget Activities", href: "/budget", icon: "budget" },
  accounts: { label: "Accounts", href: "/accounts", icon: "accounts", match: ["/vouchers", "/reconciliation", "/tpn-registration"] },
  vouchers: { label: "Vouchers", href: "/vouchers", icon: "vouchers" },
  reconciliation: { label: "Bank Reconciliation", href: "/reconciliation", icon: "reconciliation" },
  tpnRegistration: { label: "TPN Registration", href: "/tpn-registration", icon: "tpn" },
  tds: { label: "TDS Remittance", href: "/tds-remittance", icon: "tds" },
  payroll: { label: "Payroll", href: "/payroll", icon: "payroll" },
  process: { label: "Process", href: "/process", icon: "process", match: ["/month-close"] },
  monthClose: { label: "Month Close", href: "/month-close", icon: "monthClose" },
  approvals: { label: "Approval Queue", href: "/approvals", icon: "approvals" },
  ledger: { label: "General Ledger", href: "/ledger", icon: "ledger" },
  reports: { label: "Reports", href: "/reports", icon: "reports" },
  users: { label: "User Management", href: "/users", icon: "users" },
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
      { title: "Agency operations", items: [item.accounts, item.tds, item.payroll, item.process, item.reports] },
    ];
  }
  if (role === "approving_authority") {
    return [
      { title: "Workspace", items: [item.dashboard] },
      {
        title: "Approval control",
        items: [item.approvals, item.accounts, item.budget, item.payroll, item.process, item.reports],
      },
    ];
  }
  return [
    { title: "Workspace", items: [item.dashboard] },
    { title: "Agency operations", items: [item.budget, item.accounts, item.tds, item.payroll, item.ledger, item.process] },
    { title: "Control & reports", items: [item.approvals, item.reports, item.users] },
  ];
}

/** True when `pathname` falls under a nav item's own route or one it adopts. */
export function isNavItemActive(entry: NavigationItem, pathname: string): boolean {
  return [entry.href, ...(entry.match ?? [])].some((prefix) => pathname.startsWith(prefix));
}

/** Breadcrumb/title for a pathname — resolved against the full route registry. */
export function routeTitle(pathname: string): string {
  const match = Object.values(item).find((entry) => pathname.startsWith(entry.href));
  return match?.label ?? "Dashboard";
}