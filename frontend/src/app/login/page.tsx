"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PelsungLogo } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api";
import { useApp } from "@/providers/app-provider";

export default function LoginPage() {
  const router = useRouter();
  const { applyUser, refresh } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  // An unexpired cookie means the user never needs to see this screen.
  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((session) => {
        if (cancelled) return;
        applyUser(session.user);
        router.replace("/dashboard");
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyUser, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const session = await api.login(username, password);
      applyUser(session.user);
      setPassword("");
      // Signing in goes straight to the workspace — no password gate.
      await refresh();
      router.replace("/dashboard");
    } catch (loginError) {
      setError(loginError instanceof ApiError ? loginError.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <main className="auth-loading">
        <PelsungLogo className="loading-logo" />
        <span>Opening secure workspace…</span>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-brand">
            <PelsungLogo />
          </div>
          <h2>Welcome back</h2>
          <p>Sign in to the Pelsung accounting management system.</p>
          <label>
            Username
            <input
              type="email"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button login-button" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
            <span>→</span>
          </button>
        </form>
      </section>
    </main>
  );
}