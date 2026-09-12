"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { Lock, LoaderCircle, Mail, PlayCircle, ShieldCheck, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/brand-mark";

const devPasswordLogin = process.env.NODE_ENV !== "production";

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.62l4 3.1C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

const SLIDE_DURATION_MS = 5000;

function AuthSlideshow({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => setIndex((current) => (current + 1) % images.length), SLIDE_DURATION_MS);
    return () => clearInterval(id);
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    <div className="mkt-auth-slideshow" aria-hidden="true">
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className="mkt-auth-slideshow-img" style={{ opacity: i === index ? 1 : 0 }} />
      ))}
      <div className="mkt-auth-slideshow-scrim" />
    </div>
  );
}

function AuthTrustPanel({ slideshowImages }: { slideshowImages: string[] }) {
  return (
    <div className="mkt-auth-left">
      <AuthSlideshow images={slideshowImages} />
      <div className="mkt-mesh"><i /><i /></div>
      <span className="mkt-brand" style={{ position: "relative" }}><span className="mkt-brand-mark"><BrandMark size={16} /></span>Waypoint</span>
      <div>
        <span className="mkt-auth-eyebrow"><i />Verified access</span>
        <h2 className="mkt-auth-h1">Plan the trip.<br />Not the arguments.</h2>
        <p className="mkt-auth-sub">Every trip is membership-gated. Row-level security decides who sees what — not the browser.</p>
      </div>
      <div className="mkt-auth-points">
        <div className="mkt-auth-point">
          <span className="mkt-auth-point-icon"><Lock size={16} aria-hidden="true" /></span>
          <span><b>Signed sessions</b><span style={{ fontSize: 12.5, color: "var(--mkt-muted)" }}>Every request carries a short-lived Supabase session token.</span></span>
        </div>
        <div className="mkt-auth-point">
          <span className="mkt-auth-point-icon"><ShieldCheck size={16} aria-hidden="true" /></span>
          <span><b>Membership-gated trips</b><span style={{ fontSize: 12.5, color: "var(--mkt-muted)" }}>You only ever see trips you&apos;re actually a member of.</span></span>
        </div>
        <div className="mkt-auth-point">
          <span className="mkt-auth-point-icon"><UserCheck size={16} aria-hidden="true" /></span>
          <span><b>Nothing shared without you</b><span style={{ fontSize: 12.5, color: "var(--mkt-muted)" }}>Chat and preferences stay scoped to the trips you&apos;re in.</span></span>
        </div>
      </div>
    </div>
  );
}

/**
 * Prototype entry: a sign-in form for show only. It accepts ANY email/password (or none) and
 * drops a `wp_prototype` marker cookie -- that cookie is NOT what unlocks anything; middleware
 * bypasses auth purely from `isPrototype()`. Rendered by the login page in place of the real
 * sign-in form when the build is in prototype mode.
 */
export function PrototypeEntry({ slideshowImages = [] }: { slideshowImages?: string[] }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function enterDemo() {
    document.cookie = "wp_prototype=1; path=/; max-age=86400; samesite=lax";
    window.location.href = "/chats";
  }

  return (
    <main className="mkt mkt-auth">
      <AuthTrustPanel slideshowImages={slideshowImages} />
      <div className="mkt-auth-right">
        <div className="mkt-auth-form">
          <span className="mkt-auth-form-eyebrow">Demo build</span>
          <h1>Sign in</h1>
          <p>Any email and password get you in, and all data is sample data that resets on refresh.</p>
          <form className="login-form" onSubmit={(event) => { event.preventDefault(); enterDemo(); }}>
            <label>Email
              <input name="email" type="email" autoComplete="email" placeholder="you@example.com"
                value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>Password
              <input name="password" type="password" autoComplete="current-password"
                value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button className="mkt-btn mkt-btn-primary mkt-btn-block" type="submit">
              <PlayCircle aria-hidden="true" />Sign in to the demo
            </button>
          </form>
          <div className="mkt-divider">or continue with</div>
          <button type="button" className="mkt-btn-google" onClick={enterDemo}>
            <GoogleG />Continue with Google (demo)
          </button>
        </div>
      </div>
    </main>
  );
}

export function LoginForm({ configured, slideshowImages = [] }: { configured: boolean; slideshowImages?: string[] }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [devPending, setDevPending] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
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

  // signInWithOAuth redirects the browser to Google itself on success, so there is no follow-up
  // navigation here -- only a thrown/returned error (provider not enabled, network failure) ever
  // reaches this component.
  async function withGoogle() {
    if (!configured || googlePending) return;
    setGooglePending(true);
    setGoogleError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithOAuth({
        provider: "google", options: { redirectTo: window.location.origin + "/auth/callback" },
      });
      if (authError) throw new Error(authError.message);
    } catch (cause) {
      if (mounted.current) setGoogleError(cause instanceof Error ? cause.message : "Unable to continue with Google. Please try again.");
    } finally {
      if (mounted.current) setGooglePending(false);
    }
  }

  return (
    <main className="mkt mkt-auth">
      <AuthTrustPanel slideshowImages={slideshowImages} />
      <div className="mkt-auth-right">
        <div className="mkt-auth-form">
          <span className="mkt-auth-form-eyebrow">Welcome back</span>
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

          <div className="mkt-divider">or continue with</div>
          <button type="button" className="mkt-btn-google" onClick={withGoogle} disabled={!configured || googlePending}>
            {googlePending ? <LoaderCircle className="spin" aria-hidden="true" /> : <GoogleG />}Continue with Google
          </button>
          {googleError && <p className="error-notice" role="alert" style={{ marginTop: 10 }}>{googleError}</p>}

          {devPasswordLogin && <form className="login-form dev-login-form" onSubmit={submitPassword} style={{ marginTop: 20 }}>
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
        </div>
      </div>
    </main>
  );
}
