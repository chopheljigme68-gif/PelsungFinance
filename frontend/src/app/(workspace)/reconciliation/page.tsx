"use client";

import { BankReconciliationModule } from "@/components/reconciliation/reconciliation-modules";
import { RouteGuard } from "@/components/shell/route-guard";

export default function ReconciliationPage() {
  return <RouteGuard permission="manage_bank_reconciliation">{(data) => <BankReconciliationModule data={data} />}</RouteGuard>;
}
