"use client";

import { AccountsHub } from "@/components/accounts/hub-modules";
import { RouteGuard } from "@/components/shell/route-guard";

export default function AccountsPage() {
  return <RouteGuard permission="manage_bank_reconciliation">{(data) => <AccountsHub data={data} />}</RouteGuard>;
}
