"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { Compass, LoaderCircle, Lock, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const devPasswordLogin = process.env.NODE_ENV !== "production";

export function LoginForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [devPending, setDevPending] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const locked = useRef(false);
  const devLocked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (new URLSearchParams(window.location.search).get("error") === "link_expired")
      setError("This sign-in link has expired. Request a new link.");
    return () => { mounted.current = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || locked.current) return;
    locked.current = true;
    setPending(true);
    setSent(false);
    setError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithOtp({
        email: email.trim(), options: { emailRedirectTo: window.location.origin + "/auth/callback" },
      });
      if (authError) throw new Error(authError.message);
      if (mounted.current) setSent(true);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Unable to send a sign-in link. Please try again.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || devLocked.current) return;
    devLocked.current = true;
    setDevPending(true);
    setDevError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({
        email: devEmail.trim(), password: devPassword,
      });
      if (authError) throw new Error(authError.message);
      window.location.href = "/";
    } catch (cause) {
      if (mounted.current) setDevError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
    } finally {
      devLocked.current = false;
      if (mounted.current) setDevPending(false);
    }
  }

  return <main className="login-shell">
    <div className="brand-block"><Compass aria-hidden="true" /><strong>Waypoint</strong></div>
    <h1>Sign in</h1>
    <form className="login-form" onSubmit={submit}>
    {!configured && <p className="inline-notice" role="status">Sign-in is not configured yet.</p>}
    <label>Email<input name="email" type="email" required autoComplete="email" value={email} disabled={pending || !configured}
      onChange={(event) => { setEmail(event.target.value); setSent(false); setError(null); }} /></label>
    <button className="primary-button" type="submit" disabled={!configured || pending}>
      {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : <Mail aria-hidden="true" />}{pending ? "Sending link..." : "Send sign-in link"}
    </button>
    {sent && <p className="inline-notice" role="status">Sign-in link sent. Check your email.</p>}
    {error && <p className="error-notice" role="alert">{error}</p>}
    </form>
    {devPasswordLogin && <form className="login-form dev-login-form" onSubmit={submitPassword}>
      <p className="field-hint">Dev-only password sign-in. Not available in production.</p>
      <label>Dev email<input name="dev-email" type="email" required autoComplete="email" value={devEmail} disabled={devPending || !configured}
        onChange={(event) => { setDevEmail(event.target.value); setDevError(null); }} /></label>
      <label>Dev password<input name="dev-password" type="password" required autoComplete="current-password" value={devPassword} disabled={devPending || !configured}
        onChange={(event) => { setDevPassword(event.target.value); setDevError(null); }} /></label>
      <button className="secondary-button" type="submit" disabled={!configured || devPending}>
        {devPending ? <LoaderCircle className="spin" aria-hidden="true" /> : <Lock aria-hidden="true" />}{devPending ? "Signing in..." : "Sign in with password"}
      </button>
      {devError && <p className="error-notice" role="alert">{devError}</p>}
    </form>}
  </main>;
}
