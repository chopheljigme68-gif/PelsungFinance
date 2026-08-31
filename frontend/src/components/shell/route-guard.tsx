"use client";

import type { ReactNode } from "react";
import { PelsungLogo } from "@/components/ui/primitives";
import { useApp } from "@/providers/app-provider";
import type { AccountingData, Permission } from "@/types";

/**
 * Waits for the snapshot, then checks the screen's permission.
 *
 * This is presentation only — the API enforces the same permission on every
 * request, so a user who reaches a route by typing its URL still cannot act.
 */
export function RouteGuard({
  permission,
  children,
}: {
  permission?: Permission;
  children: (data: AccountingData) => ReactNode;
}) {
  const { data, loading, can, user } = useApp();

  if (!data) {
    return loading || user ? (
      <section className="panel">
        <div className="route-denied">
          <PelsungLogo className="loading-logo" />
          <strong>Loading the accounting register…</strong>
        </div>
      </section>
    ) : null;
  }

  if (permission && !can(permission)) {
    return (
      <section className="panel">
        <div className="route-denied">
          <strong>This section is not part of your role</strong>
          <p>
            Your {data.currentUser.roleLabel} access does not include this screen. Ask an Admin if you need it for your
            work.
          </p>
        </div>
      </section>
    );
  }

  return <>{children(data)}</>;
}
