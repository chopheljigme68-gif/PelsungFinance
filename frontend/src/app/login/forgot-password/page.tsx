"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PelsungLogo } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.forgotPassword(username);
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "The request could not be sent.");
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
          <h2>Forgot password</h2>
          {sent ? (
            // Same message whether or not the address is registered.
            <div className="form-success" role="status">
              If <strong>{username.trim()}</strong> belongs to an active account, a reset link is on its way. It
              expires in 30 minutes and works once. Check your spam folder if it doesn&apos;t arrive.
            </div>
          ) : (
            <>
              <p>Enter the email address you sign in with and we&apos;ll email you a link to choose a new password.</p>
              <label>
                Email address
                <input
                  type="email"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button className="primary-button login-button" type="submit" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
                <span>→</span>
              </button>
            </>
          )}
          <Link className="login-link back-link" href="/login">
            Back to sign in
          </Link>
        </form>
      </section>
    </main>
  );
}
