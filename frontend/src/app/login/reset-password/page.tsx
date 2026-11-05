"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { PelsungLogo } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api";

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Same rules as the server and the Change password dialog.
  const normalized = newPassword.normalize("NFC");
  const length = Array.from(normalized).length;
  const validLength = length >= 8 && length <= 20;
  const hasUppercase = /\p{Lu}/u.test(normalized);
  const hasSpecialCharacter = /[\p{P}\p{S}]/u.test(normalized);
  const passwordsMatch = Boolean(newPassword) && newPassword === confirmPassword;
  const ready = validLength && hasUppercase && hasSpecialCharacter && passwordsMatch;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) {
      setError(passwordsMatch ? "The new password does not meet the policy below." : "The new passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.resetPassword({ token, newPassword, confirmPassword });
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
    } catch (resetError) {
      setError(resetError instanceof ApiError ? resetError.message : "The password could not be reset.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-brand">
            <PelsungLogo />
          </div>
          <h2>Reset password</h2>
          {done ? (
            <>
              <div className="form-success" role="status">
                Your password has been changed and you have been signed out on every device. Sign in with your new
                password.
              </div>
              <Link className="primary-button login-button" href="/login">
                Go to sign in
                <span>→</span>
              </Link>
            </>
          ) : !token ? (
            <div className="form-error" role="alert">
              This reset link is incomplete. Open it again from your email, or request a new one.
            </div>
          ) : (
            <>
              <p>Pick a new password for your Pelsung Finance account.</p>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  minLength={8}
                  maxLength={20}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  minLength={8}
                  maxLength={20}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <div className="password-policy">
                <strong>Password policy</strong>
                <ul>
                  <li className={validLength ? "met" : ""}>8–20 characters</li>
                  <li className={hasSpecialCharacter ? "met" : ""}>At least one special character</li>
                  <li className={hasUppercase ? "met" : ""}>At least one uppercase letter</li>
                  <li className={passwordsMatch ? "met" : ""}>Both fields match</li>
                </ul>
              </div>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button className="primary-button login-button" type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save new password"}
                <span>→</span>
              </button>
            </>
          )}
          {!done && (
            <Link className="login-link back-link" href={token ? "/login" : "/login/forgot-password"}>
              {token ? "Back to sign in" : "Request a new link"}
            </Link>
          )}
        </form>
      </section>
    </main>
  );
}
