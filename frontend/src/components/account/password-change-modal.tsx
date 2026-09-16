"use client";

import { useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import type { AppUser } from "@/types";

/**
 * Password change, opened on demand from the account controls.
 *
 * Always dismissible: nothing in the system forces a password change, so the
 * dialog closes on Cancel, on the × and on a click outside it.
 */
export function PasswordChangeModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: (user: AppUser) => Promise<void> | void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const normalized = newPassword.normalize("NFC");
  const length = Array.from(normalized).length;
  const validLength = length >= 8 && length <= 20;
  const hasUppercase = /\p{Lu}/u.test(normalized);
  const hasSpecialCharacter = /[\p{P}\p{S}]/u.test(normalized);
  const passwordsMatch = Boolean(newPassword) && newPassword === confirmPassword;
  const strength = [validLength, hasUppercase, hasSpecialCharacter, passwordsMatch].filter(Boolean).length;

  // Naming what is still missing, rather than only greying out the button.
  const unmet = [
    !validLength && "use 8–20 characters",
    !hasUppercase && "add an uppercase letter",
    !hasSpecialCharacter && "add a special character such as @ ! # or -",
    Boolean(newPassword) && !passwordsMatch && "make both new password fields match",
  ].filter((requirement): requirement is string => Boolean(requirement));
  const ready = validLength && hasUppercase && hasSpecialCharacter && passwordsMatch;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await api.changePassword({ currentPassword, newPassword, confirmPassword });
      await onChanged(response.user);
    } catch (changeError) {
      setError(changeError instanceof ApiError ? changeError.message : "Password could not be changed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <form className="modal-card password-card" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow dark">Account security</span>
            <h2>Change password</h2>
            <p>Changing your password signs out your other active sessions.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="password-fields">
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              minLength={8}
              maxLength={20}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <div className="strength-meter" aria-label={`Password requirements met ${strength} of 4`}>
            {[1, 2, 3, 4].map((step) => (
              <i key={step} className={strength >= step ? "filled" : ""} />
            ))}
          </div>
          <label>
            Confirm new password
            <input
              type="password"
              minLength={8}
              maxLength={20}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        </div>

        <div className="password-policy">
          <strong>Password policy</strong>
          <ul>
            <li className={validLength ? "met" : ""}>8–20 characters</li>
            <li className={hasSpecialCharacter ? "met" : ""}>At least one special character</li>
            <li className={hasUppercase ? "met" : ""}>At least one uppercase letter</li>
          </ul>
        </div>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        {newPassword && !ready && (
          <p className="password-hint" role="status">
            To continue, {unmet.join(", and ")}.
          </p>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || !ready}>
            {saving ? "Updating…" : "Update password"}
          </button>
        </footer>
      </form>
    </div>
  );
}
