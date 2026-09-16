"use client";

import { ProcessHub } from "@/components/accounts/hub-modules";
import { RouteGuard } from "@/components/shell/route-guard";

export default function ProcessPage() {
  return <RouteGuard permission="manage_month_close">{(data) => <ProcessHub data={data} />}</RouteGuard>;
}
