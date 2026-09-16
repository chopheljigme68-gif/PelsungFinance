"use client";

import { useState } from "react";
import {
  BudgetActivityModal,
  BudgetReappropriationModal,
  SupplementaryBudgetModal,
} from "@/components/budget/budget-modals";
import { RouteGuard } from "@/components/shell/route-guard";
import { Empty, ModuleHero, PlusIcon } from "@/components/ui/primitives";
import { fiscalYearLabel, money, timestamp } from "@/lib/format";
import { useApp } from "@/providers/app-provider";
import type { AccountingData } from "@/types";

export default function BudgetPage() {
  return <RouteGuard permission="view_budget">{(data) => <BudgetActivities data={data} />}</RouteGuard>;
}

type OpenModal = "activity" | "reappropriation" | "supplementary" | null;

function BudgetActivities({ data }: { data: AccountingData }) {
  const { can, fiscalYear, changeFiscalYear } = useApp();
  const [modal, setModal] = useState<OpenModal>(null);

  const { activities, budgetReappropriations: reappropriations, supplementaryBudgets, fiscalYears } = data;
  const approved = activities.reduce((sum, item) => sum + Number(item.approvedNu), 0);
  const current = activities
    .filter((item) => item.budgetType === "Current")
    .reduce((sum, item) => sum + Number(item.approvedNu), 0);
  const capital = approved - current;

  return (
    <>
      <ModuleHero
        eyebrow={`Budget administration · ${fiscalYearLabel(fiscalYear)}`}
        title="Approved budget activities"
        description="Review approved activities, add supplementary allocations and transfer available budget through controlled re-appropriation."
        actions={
          <>
            {can("supplementary_budget") && (
              <button
                className="secondary-button"
                onClick={() => setModal("supplementary")}
                disabled={!activities.length}
                title={activities.length ? "Add supplementary allocation to an existing activity" : "Add a budget activity first"}
              >
                ＋ Supplementary budget
              </button>
            )}
            {can("reappropriate_budget") && (
              <button
                className="secondary-button"
                onClick={() => setModal("reappropriation")}
                disabled={activities.length < 2}
                title={
                  activities.length < 2
                    ? "At least two budget activities are required"
                    : "Transfer available budget between activities"
                }
              >
                ⇄ Re-appropriate budget
              </button>
            )}
            {can("manage_budget") && (
              <button
                className="icon-button"
                onClick={() => setModal("activity")}
                aria-label="Add budget activity"
                title="Add budget activity"
              >
                <PlusIcon />
              </button>
            )}
          </>
        }
      />

      <section
        className="panel voucher-register-selection budget-fiscal-year-selection"
        aria-label="Budget activities financial year selection"
      >
        <div>
          <span className="eyebrow dark">Approved budget period</span>
          <h3>Select Financial Year</h3>
          <p>Approved budget details, balances and budget histories below are limited to the selected financial year.</p>
        </div>
        <label>
          Financial Year
          <select value={fiscalYear} onChange={(event) => void changeFiscalYear(event.target.value)}>
            {fiscalYears.map((year) => (
              <option key={year} value={year}>
                {fiscalYearLabel(year)}
              </option>
            ))}
          </select>
          <small>The selected year also becomes the active financial year across the system.</small>
        </label>
      </section>

      <section className="register-summary">
        <div>
          <span>Activities</span>
          <strong>{activities.length}</strong>
        </div>
        <div>
          <span>Total approved</span>
          <strong>{money.format(approved)}</strong>
        </div>
        <div>
          <span>Current budget</span>
          <strong>{money.format(current)}</strong>
        </div>
        <div>
          <span>Capital budget</span>
          <strong>{money.format(capital)}</strong>
        </div>
      </section>

      <section className="panel register-panel">
        <div className="register-toolbar">
          <div>
            <h3>Budget activity register</h3>
            <p>{fiscalYearLabel(fiscalYear)} approved activities available across the system</p>
          </div>
          <button className="secondary-button" onClick={() => window.print()}>
            Print register
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>OBC</th>
                <th>Activity</th>
                <th>Programme</th>
                <th>Financing</th>
                <th>Type</th>
                <th className="amount-cell">Approved</th>
                <th className="amount-cell">Committed</th>
                <th className="amount-cell">Available</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="obc-code">{item.obc}</span>
                  </td>
                  <td>
                    <strong>{item.activity}</strong>
                    <small>{item.brief}</small>
                  </td>
                  <td>{item.category}</td>
                  <td>{item.financing}</td>
                  <td>
                    <span className={`type-chip ${item.budgetType.toLowerCase()}`}>{item.budgetType}</span>
                  </td>
                  <td className="amount-cell">{money.format(item.approvedNu)}</td>
                  <td className="amount-cell">{money.format(item.committedNu)}</td>
                  <td className="amount-cell">
                    <strong>{money.format(item.approvedNu - item.committedNu)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!activities.length && (
            <Empty
              message={`No approved budget activities exist for ${fiscalYearLabel(fiscalYear)}. An Admin can add the new year's budget here.`}
            />
          )}
        </div>
      </section>

      <section className="panel register-panel reappropriation-history">
        <div className="register-toolbar">
          <div>
            <h3>Re-appropriation history</h3>
            <p>Permanent record of approved allocation transfers in {fiscalYearLabel(fiscalYear)}</p>
          </div>
          <span className="fy-chip">
            {reappropriations.length} TRANSFER{reappropriations.length === 1 ? "" : "S"}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>From activity</th>
                <th>To activity</th>
                <th className="amount-cell">Amount transferred</th>
                <th>Reason</th>
                <th>Processed by</th>
              </tr>
            </thead>
            <tbody>
              {reappropriations.map((transfer) => (
                <tr key={transfer.id}>
                  <td>{timestamp(transfer.transferredAt)}</td>
                  <td>
                    <strong className="obc-code">{transfer.sourceObc}</strong>
                    <small>{transfer.sourceActivity}</small>
                  </td>
                  <td>
                    <strong className="obc-code">{transfer.destinationObc}</strong>
                    <small>{transfer.destinationActivity}</small>
                  </td>
                  <td className="amount-cell">
                    <strong>{money.format(transfer.amountNu)}</strong>
                  </td>
                  <td>{transfer.reason}</td>
                  <td>{transfer.transferredByName ?? "Admin"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!reappropriations.length && (
            <Empty message="No budget re-appropriation has been recorded for this financial year." />
          )}
        </div>
      </section>

      <section className="panel register-panel supplementary-history">
        <div className="register-toolbar">
          <div>
            <h3>Supplementary budget history</h3>
            <p>Permanent record of additional approved allocations in {fiscalYearLabel(fiscalYear)}</p>
          </div>
          <span className="fy-chip">
            {supplementaryBudgets.length} SUPPLEMENT{supplementaryBudgets.length === 1 ? "" : "S"}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Budget activity</th>
                <th>Programme</th>
                <th className="amount-cell">Supplementary amount</th>
                <th>Reason / approval reference</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {supplementaryBudgets.map((supplement) => (
                <tr key={supplement.id}>
                  <td>{timestamp(supplement.grantedAt)}</td>
                  <td>
                    <strong className="obc-code">{supplement.obc}</strong>
                    <small>{supplement.activity}</small>
                  </td>
                  <td>{supplement.category}</td>
                  <td className="amount-cell">
                    <strong>{money.format(supplement.amountNu)}</strong>
                  </td>
                  <td>{supplement.reason}</td>
                  <td>{supplement.grantedByName ?? "Approving officer"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!supplementaryBudgets.length && (
            <Empty message="No supplementary budget has been recorded for this financial year." />
          )}
        </div>
      </section>

      {modal === "activity" && <BudgetActivityModal onClose={() => setModal(null)} />}
      {modal === "reappropriation" && (
        <BudgetReappropriationModal activities={activities} onClose={() => setModal(null)} />
      )}
      {modal === "supplementary" && <SupplementaryBudgetModal activities={activities} onClose={() => setModal(null)} />}
    </>
  );
}
