"use client";

import { useState, type FormEvent } from "react";
import { Empty, ModalShell, ModuleHero } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { timestamp } from "@/lib/format";
import { useApp } from "@/providers/app-provider";
import type { AccountingData } from "@/types";

export function TpnRegistrationModule({ data }: { data: AccountingData }) {
  const { can } = useApp();
  const canManage = can("manage_tpn");
  const [adding, setAdding] = useState(false);

  const registrations = [...data.tpnRegistrations].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <ModuleHero
        eyebrow="Agency operations · Accounts"
        title="TPN Registration"
        description="Register taxpayer numbers here so they can be selected on vouchers that carry 2% or 5% TDS."
        actions={
          canManage && (
            <button className="primary-button" onClick={() => setAdding(true)}>
              ＋ Register TPN
            </button>
          )
        }
      />

      <section className="register-summary">
        <div>
          <span>Registered TPNs</span>
          <strong>{registrations.length}</strong>
        </div>
      </section>

      <section className="panel register-panel">
        <div className="register-toolbar">
          <div>
            <h3>TPN registry</h3>
            <p>Available across the system when preparing a TDS voucher.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>TPN</th>
                <th>Name</th>
                <th>Registered by</th>
                <th>Registered on</th>
                {canManage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => (
                <tr key={registration.id}>
                  <td>
                    <span className="obc-code">{registration.tpn}</span>
                  </td>
                  <td>
                    <strong>{registration.name}</strong>
                  </td>
                  <td>{registration.createdByName ?? "—"}</td>
                  <td>{timestamp(registration.createdAt)}</td>
                  {canManage && (
                    <td>
                      <RemoveButton id={registration.id} tpn={registration.tpn} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!registrations.length && (
            <Empty message="No TPNs are registered yet. Register one before creating a voucher with TDS." />
          )}
        </div>
      </section>

      {adding && <TpnRegistrationModal onClose={() => setAdding(false)} />}
    </>
  );
}

function RemoveButton({ id, tpn }: { id: number; tpn: string }) {
  const { run } = useApp();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!window.confirm(`Remove TPN ${tpn} from the registry? Existing vouchers keep their recorded TPN.`)) return;
    setBusy(true);
    await run(() => api.deleteTpnRegistration(id), `TPN ${tpn} was removed.`);
    setBusy(false);
  };
  return (
    <button className="voucher-budget-line-remove" disabled={busy} onClick={() => void remove()}>
      Remove
    </button>
  );
}

function TpnRegistrationModal({ onClose }: { onClose: () => void }) {
  const { run } = useApp();
  const [tpn, setTpn] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const normalizedTpn = tpn.trim().toLocaleUpperCase();
  const valid = normalizedTpn.length >= 3 && name.trim().length >= 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    const saved = await run(
      () => api.addTpnRegistration({ tpn: normalizedTpn, name: name.trim() }),
      `TPN ${normalizedTpn} (${name.trim()}) was registered.`,
    );
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <ModalShell onClose={onClose}>
      <form className="modal-card" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Agency operations · Accounts</span>
            <h2>Register TPN</h2>
            <p>The taxpayer number will be selectable on vouchers that carry TDS.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="form-grid">
          <label>
            TPN
            <input
              maxLength={30}
              value={tpn}
              onChange={(event) =>
                setTpn(event.target.value.toLocaleUpperCase().replace(/[^A-Z0-9./-]/g, "").slice(0, 30))
              }
              placeholder="e.g. PT-1234567"
              required
            />
          </label>
          <label>
            Name
            <input
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Taxpayer / supplier name"
              required
            />
          </label>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || !valid}>
            {saving ? "Registering…" : "Register TPN"}
          </button>
        </footer>
      </form>
    </ModalShell>
  );
}
