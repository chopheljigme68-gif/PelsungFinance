"use client";

import { TpnRegistrationModule } from "@/components/accounts/tpn-registration";
import { RouteGuard } from "@/components/shell/route-guard";

export default function TpnRegistrationPage() {
  return <RouteGuard permission="manage_tpn">{(data) => <TpnRegistrationModule data={data} />}</RouteGuard>;
}
