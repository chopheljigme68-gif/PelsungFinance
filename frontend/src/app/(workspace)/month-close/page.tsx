"use client";

import { MonthCloseModule } from "@/components/reconciliation/reconciliation-modules";
import { RouteGuard } from "@/components/shell/route-guard";

export default function MonthClosePage() {
  return <RouteGuard permission="manage_month_close">{(data) => <MonthCloseModule data={data} />}</RouteGuard>;
}
