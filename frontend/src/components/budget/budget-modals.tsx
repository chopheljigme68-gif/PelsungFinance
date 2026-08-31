"use client";

import { useState, type FormEvent } from "react";
import { ModalShell } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { fiscalYearLabel, money } from "@/lib/format";
import { useApp } from "@/providers/app-provider";
import type { Activity } from "@/types";

/* -------------------------------------------------------------------------- */
/* Add budget activity                                                        */
/* -------------------------------------------------------------------------- */

export function BudgetActivityModal({ onClose }: { onClose: () => void }) {
  const { fiscalYear, run } = useApp();
  const [category, setCategory] = useState("");
  const [financing, setFinancing] = useState("RGoB");
  const [obc, setObc] = useState("");
  const [activity, setActivity] = useState("");
  const [budgetType, setBudgetType] = useState<"Current" | "Capital">("Current");
  const [approvedNu, setApprovedNu] = useState("");
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const saved = await run(
      () =>
        api.addBudgetActivity({
          fiscalYear,
          category,
          financing,
          obc,
          activity,
          budgetType,
          approvedNu: Number(approvedNu),
          brief,
        }),
      `${activity} was added to the approved budget register.`,
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <form className="modal-card" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Budget administration · {fiscalYearLabel(fiscalYear)}</span>
            <h2>Add budget activity</h2>
            <p>The approved allocation will be recorded only under the selected financial year.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="form-grid">
          <label>
            Programme / category
            <input
              maxLength={120}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="e.g. Programme Operations"
              required
            />
          </label>
          <label>
            Financing source
            <input
              maxLength={80}
              value={financing}
              onChange={(event) => setFinancing(event.target.value)}
              placeholder="e.g. RGoB"
              required
            />
          </label>
          <label>
            OBC code
            <input
              maxLength={30}
              value={obc}
              onChange={(event) => setObc(event.target.value)}
              placeholder="e.g. 17.01"
              required
            />
          </label>
          <label>
            Budget type
            <select value={budgetType} onChange={(event) => setBudgetType(event.target.value as "Current" | "Capital")}>
              <option>Current</option>
              <option>Capital</option>
            </select>
          </label>
          <label className="wide">
            Activity name
            <input
              maxLength={240}
              value={activity}
              onChange={(event) => setActivity(event.target.value)}
              placeholder="Enter the approved activity title"
              required
            />
          </label>
          <label className="wide">
            Approved allocation (Nu.)
            <input
              type="number"
              min="1"
              max="1000000000000"
              step="1"
              value={approvedNu}
              onChange={(event) => setApprovedNu(event.target.value)}
              placeholder="0"
              required
            />
          </label>
          <label className="wide">
            Description / purpose
            <textarea
              maxLength={500}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Briefly describe the approved purpose and scope"
              required
            />
          </label>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? "Adding…" : "Add activity"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Re-appropriation                                                           */
/* -------------------------------------------------------------------------- */

export function BudgetReappropriationModal({ activities, onClose }: { activities: Activity[]; onClose: () => void }) {
  const { fiscalYear, run } = useApp();
  const [sourceActivityId, setSourceActivityId] = useState(activities[0]?.id ?? 0);
  const [destinationActivityId, setDestinationActivityId] = useState(
    activities.find((activity) => activity.id !== activities[0]?.id)?.id ?? 0,
  );
  const [amountNu, setAmountNu] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const sourceActivity = activities.find((activity) => activity.id === sourceActivityId);
  const destinationActivity = activities.find((activity) => activity.id === destinationActivityId);
  const sourceAvailableNu = sourceActivity ? Math.max(sourceActivity.approvedNu - sourceActivity.committedNu, 0) : 0;
  const transferAmountNu = Math.round(Number(amountNu));
  const projectedSourceNu = sourceActivity
    ? sourceActivity.approvedNu - (Number.isFinite(transferAmountNu) ? transferAmountNu : 0)
    : 0;
  const projectedDestinationNu = destinationActivity
    ? destinationActivity.approvedNu + (Number.isFinite(transferAmountNu) ? transferAmountNu : 0)
    : 0;

  const selectSource = (nextSourceId: number) => {
    setSourceActivityId(nextSourceId);
    if (destinationActivityId === nextSourceId) {
      setDestinationActivityId(activities.find((activity) => activity.id !== nextSourceId)?.id ?? 0);
    }
    setAmountNu("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sourceActivity || !destinationActivity || transferAmountNu <= 0 || transferAmountNu > sourceAvailableNu) return;
    setSaving(true);
    const saved = await run(
      () =>
        api.reappropriateBudget({
          fiscalYear,
          sourceActivityId,
          destinationActivityId,
          amountNu: transferAmountNu,
          reason,
        }),
      `${money.format(transferAmountNu)} was re-appropriated from ${sourceActivity.obc} to ${destinationActivity.obc}. Both activity balances and the history have been updated.`,
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <form className="modal-card reappropriation-modal" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Budget administration · {fiscalYearLabel(fiscalYear)}</span>
            <h2>Re-appropriate budget</h2>
            <p>Transfer available approved allocation from one budget activity to another.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="form-grid">
          <label className="wide">
            From budget activity
            <select value={sourceActivityId} onChange={(event) => selectSource(Number(event.target.value))} required>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.obc} — {activity.activity} ({activity.category})
                </option>
              ))}
            </select>
          </label>
          <div className="reappropriation-balance wide">
            <span>
              Source approved allocation<strong>{money.format(sourceActivity?.approvedNu ?? 0)}</strong>
            </span>
            <span>
              Committed expenditure<strong>{money.format(sourceActivity?.committedNu ?? 0)}</strong>
            </span>
            <span>
              Available to transfer<strong>{money.format(sourceAvailableNu)}</strong>
            </span>
          </div>
          <label className="wide">
            To budget activity
            <select
              value={destinationActivityId}
              onChange={(event) => setDestinationActivityId(Number(event.target.value))}
              required
            >
              {activities
                .filter((activity) => activity.id !== sourceActivityId)
                .map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.obc} — {activity.activity} ({activity.category})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Amount to transfer (Nu.)
            <input
              type="number"
              min="1"
              max={sourceAvailableNu}
              step="1"
              value={amountNu}
              onChange={(event) => setAmountNu(event.target.value)}
              placeholder="0"
              required
            />
          </label>
          <label>
            Available source balance
            <input value={money.format(sourceAvailableNu)} readOnly aria-readonly="true" />
          </label>
          <label className="wide">
            Reason for re-appropriation
            <textarea
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="State the approval reference and purpose of the transfer"
              required
            />
          </label>
          {transferAmountNu > 0 && transferAmountNu <= sourceAvailableNu && (
            <section className="reappropriation-preview wide" aria-label="Re-appropriation result">
              <div>
                <span>Source allocation after transfer</span>
                <strong>{money.format(projectedSourceNu)}</strong>
              </div>
              <div>
                <span>Destination allocation after transfer</span>
                <strong>{money.format(projectedDestinationNu)}</strong>
              </div>
              <p>Total approved budget remains unchanged.</p>
            </section>
          )}
          {transferAmountNu > sourceAvailableNu && (
            <div className="form-error wide" role="alert">
              The transfer cannot exceed the source activity&rsquo;s available balance of{" "}
              {money.format(sourceAvailableNu)}.
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={
              saving ||
              !sourceActivity ||
              !destinationActivity ||
              transferAmountNu <= 0 ||
              transferAmountNu > sourceAvailableNu ||
              reason.trim().length < 5
            }
          >
            {saving ? "Transferring…" : "Confirm re-appropriation"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Supplementary budget                                                       */
/* -------------------------------------------------------------------------- */

export function SupplementaryBudgetModal({ activities, onClose }: { activities: Activity[]; onClose: () => void }) {
  const { fiscalYear, run } = useApp();
  const [activityId, setActivityId] = useState(activities[0]?.id ?? 0);
  const [amountNu, setAmountNu] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const activity = activities.find((item) => item.id === activityId);
  const supplementaryAmountNu = Math.round(Number(amountNu));
  const currentApprovedNu = activity?.approvedNu ?? 0;
  const currentAvailableNu = activity ? Math.max(activity.approvedNu - activity.committedNu, 0) : 0;
  const validAmount =
    Number.isFinite(supplementaryAmountNu) && supplementaryAmountNu > 0 && supplementaryAmountNu <= 1_000_000_000_000;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activity || !validAmount || reason.trim().length < 5) return;
    setSaving(true);
    const saved = await run(
      () => api.addSupplementaryBudget({ fiscalYear, activityId, amountNu: supplementaryAmountNu, reason }),
      `${money.format(supplementaryAmountNu)} supplementary budget was added to ${activity.obc}. Its approved and available balances have been updated.`,
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <form className="modal-card supplementary-budget-modal" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Budget administration · {fiscalYearLabel(fiscalYear)}</span>
            <h2>Add supplementary budget</h2>
            <p>Increase the approved allocation of an existing budget activity.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="form-grid">
          <label className="wide">
            Existing budget activity
            <select
              value={activityId}
              onChange={(event) => {
                setActivityId(Number(event.target.value));
                setAmountNu("");
              }}
              required
            >
              {activities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.obc} — {item.activity} ({item.category})
                </option>
              ))}
            </select>
          </label>
          <div className="reappropriation-balance wide">
            <span>
              Current approved allocation<strong>{money.format(currentApprovedNu)}</strong>
            </span>
            <span>
              Committed expenditure<strong>{money.format(activity?.committedNu ?? 0)}</strong>
            </span>
            <span>
              Current available balance<strong>{money.format(currentAvailableNu)}</strong>
            </span>
          </div>
          <label className="wide">
            Supplementary amount (Nu.)
            <input
              type="number"
              min="1"
              max="1000000000000"
              step="1"
              value={amountNu}
              onChange={(event) => setAmountNu(event.target.value)}
              placeholder="0"
              required
            />
          </label>
          <label className="wide">
            Reason / approval reference
            <textarea
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="State the supplementary approval reference and purpose"
              required
            />
          </label>
          {validAmount && (
            <section className="supplementary-preview wide" aria-label="Supplementary budget result">
              <div>
                <span>Revised approved allocation</span>
                <strong>{money.format(currentApprovedNu + supplementaryAmountNu)}</strong>
              </div>
              <div>
                <span>Revised available balance</span>
                <strong>{money.format(currentAvailableNu + supplementaryAmountNu)}</strong>
              </div>
              <p>
                The supplementary amount increases the selected activity and the financial year&rsquo;s total approved
                budget.
              </p>
            </section>
          )}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || !activity || !validAmount || reason.trim().length < 5}>
            {saving ? "Adding…" : "Confirm supplementary budget"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}
