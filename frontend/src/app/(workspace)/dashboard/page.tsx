"use client";

import { useMemo } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { Empty, Kpi, PanelHeader } from "@/components/ui/primitives";
import { fiscalYearLabel, money } from "@/lib/format";
import { programmeTotals, workspaceTotals } from "@/lib/totals";
import type { AccountingData } from "@/types";

export default function DashboardPage() {
  return <RouteGuard>{(data) => <Dashboard data={data} />}</RouteGuard>;
}

function Dashboard({ data }: { data: AccountingData }) {
  const totals = useMemo(() => workspaceTotals(data), [data]);
  const categories = useMemo(() => programmeTotals(data.activities), [data.activities]);

  const maxCategory = Math.max(...categories.map((item) => item.amount), 1);
  const utilization = totals.approved ? (totals.utilized / totals.approved) * 100 : 0;
  const currentShare = totals.approved ? (totals.current / totals.approved) * 100 : 0;
  const capitalShare = totals.approved ? 100 - currentShare : 0;

  return (
    <>
      <section className="welcome-row">
        <div>
          <span className="eyebrow dark">Financial year {data.fiscalYear.replace("-", "–")}</span>
          <h2>{data.currentUser.displayName}</h2>
          <p>
            {data.currentUser.roleLabel} access · Your permitted finance operations and Pelsung&apos;s consolidated
            transaction position.
          </p>
        </div>
      </section>

      <section className="kpi-grid">
        <Kpi label="Approved budget" value={money.format(totals.approved)} note="Current + capital" tone="navy" icon="Nu" />
        <Kpi
          label="Utilized"
          value={money.format(totals.utilized)}
          note={`${utilization.toFixed(1)}% of approved budget`}
          tone="teal"
          icon="↗"
        />
        <Kpi
          label="Available balance"
          value={money.format(totals.available)}
          note={`${money.format(totals.committed - totals.utilized)} committed`}
          tone="gold"
          icon="="
        />
        <Kpi
          label="Bank movement"
          value={money.format(totals.bankMovement)}
          note={`${money.format(totals.cashInHand)} cash in hand · ${money.format(totals.outstandingAdvances)} outstanding advances`}
          tone="teal"
          icon="⇄"
        />
        <Kpi label="Pending approvals" value={String(totals.pending)} note="Voucher action required" tone="berry" icon="!" />
      </section>

      <section className="dashboard-grid">
        <article className="panel category-panel">
          <PanelHeader title="Budget by programme" subtitle="Approved allocation across Pelsung workstreams" />
          <div className="category-bars">
            {categories.map((item, index) => (
              <div className="category-row" key={item.name}>
                <span className={`category-dot dot-${index % 6}`} />
                <div>
                  <strong>{item.name}</strong>
                  <div className="bar-track">
                    <i style={{ width: `${(item.amount / maxCategory) * 100}%` }} />
                  </div>
                </div>
                <b>{money.format(item.amount)}</b>
              </div>
            ))}
            {!categories.length && (
              <Empty message={`No approved programme allocations exist for ${fiscalYearLabel(data.fiscalYear)}.`} />
            )}
          </div>
        </article>

        <article className="panel budget-mix-panel">
          <PanelHeader title="Budget composition" subtitle="Current and capital allocation" />
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: totals.approved
                  ? `conic-gradient(#0d7768 0 ${currentShare}%, #d7a52a ${currentShare}% 100%)`
                  : "#e7ecef",
              }}
            >
              <span>
                <strong>{money.format(totals.approved)}</strong>
                <small>Total approved</small>
              </span>
            </div>
            <div className="donut-legend">
              <div>
                <i className="legend-current" />
                <span>
                  Current budget<small>{money.format(totals.current)}</small>
                </span>
                <b>{currentShare.toFixed(0)}%</b>
              </div>
              <div>
                <i className="legend-capital" />
                <span>
                  Capital budget<small>{money.format(totals.capital)}</small>
                </span>
                <b>{capitalShare.toFixed(0)}%</b>
              </div>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}
