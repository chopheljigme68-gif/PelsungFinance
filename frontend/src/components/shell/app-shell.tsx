"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PasswordChangeModal } from "@/components/account/password-change-modal";
import { PelsungLogo } from "@/components/ui/primitives";
import { DEFAULT_FISCAL_YEARS } from "@/lib/fiscal-year";
import { fiscalYearLabel, initials } from "@/lib/format";
import { isNavItemActive, navigationFor, routeTitle } from "@/lib/navigation";
import { useApp } from "@/providers/app-provider";

/**
 * The signed-in workspace frame: sidebar, top bar and notices. Individual
 * screens render inside `children`.
 *
 * Changing a password is voluntary — it opens only from the account controls,
 * never automatically after signing in.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    user,
    data,
    fiscalYear,
    loading,
    notice,
    clearNotice,
    changeFiscalYear,
    passwordModalOpen,
    setPasswordModalOpen,
    applyUser,
    refresh,
    signOut,
  } = useApp();
  const [mobileNav, setMobileNav] = useState(false);

  // Not signed in: the session cookie is gone or expired.
  useEffect(() => {
    if (!loading && !user && !data) router.replace("/login");
  }, [data, loading, router, user]);

  if (!user) {
    return (
      <main className="auth-loading">
        <PelsungLogo className="loading-logo" />
        <span>Opening secure workspace…</span>
      </main>
    );
  }

  const pendingApprovals = (data?.vouchers ?? []).filter((voucher) => voucher.status === "Pending").length;
  const view = routeTitle(pathname);

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <PelsungLogo />
        </div>
        <nav aria-label="Primary navigation">
          {navigationFor(user.role).map((group) => (
            <div className="nav-group" key={group.title}>
              <span className="nav-label">{group.title}</span>
              {group.items.map((entry) => (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className={isNavItemActive(entry, pathname) ? "nav-active" : ""}
                  onClick={() => setMobileNav(false)}
                >
                  <span aria-hidden="true">{entry.icon}</span>
                  {entry.label}
                  {entry.href === "/approvals" && pendingApprovals > 0 && <b>{pendingApprovals}</b>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar avatar-gold">{initials(user.displayName)}</span>
          <span>
            <strong>{user.displayName}</strong>
            <small>{user.roleLabel}</small>
          </span>
          <div className="account-actions">
            <button aria-label="Change password" title="Change password" onClick={() => setPasswordModalOpen(true)}>
              ⚙
            </button>
            <button aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
              ↪
            </button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(!mobileNav)}>
            ☰
          </button>
          <div>
            <span className="breadcrumb">
              Pelsung Finance <b>/</b> {view}
            </span>
            <h1>{view}</h1>
          </div>
          <div className="topbar-actions">
            <select
              className="fy-selector"
              aria-label="Change financial year"
              title="Change financial year"
              value={fiscalYear}
              disabled={loading}
              onChange={(event) => void changeFiscalYear(event.target.value)}
            >
              {(data?.fiscalYears ?? DEFAULT_FISCAL_YEARS).map((year) => (
                <option key={year} value={year}>
                  {fiscalYearLabel(year)}
                </option>
              ))}
            </select>
            <span className="role-chip">{user.roleLabel}</span>
            <button className="password-action" onClick={() => setPasswordModalOpen(true)}>
              Change password
            </button>
            <button className="logout-action" onClick={() => void signOut()}>
              Log out
            </button>
          </div>
        </header>

        <div className="content">
          {notice && (
            <button className="notice" onClick={clearNotice}>
              {notice}
              <span>×</span>
            </button>
          )}
          {loading && <div className="loading-line" aria-label="Loading" />}
          {children}
        </div>
      </section>

      {passwordModalOpen && (
        <PasswordChangeModal
          onClose={() => setPasswordModalOpen(false)}
          onChanged={async (updated) => {
            applyUser(updated);
            setPasswordModalOpen(false);
            await refresh();
          }}
        />
      )}
    </main>
  );
}