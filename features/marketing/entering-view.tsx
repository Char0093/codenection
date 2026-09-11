"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, ShieldCheck } from "lucide-react";

const STEPS = [
  "Establishing a secure session…",
  "Verifying workspace access…",
  "Loading your trips…",
];

/**
 * The branded interstitial between the public landing page and /login. Purely a transition
 * moment -- no auth happens here. Auto-advances to /login; a visible Skip exists for anyone
 * who doesn't want to wait out the animation (also the reduced-motion path lands here fast).
 */
export function EnteringView() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const barRef = useRef<HTMLElement>(null);
  const doneRef = useRef(false);

  function proceed() {
    if (doneRef.current) return;
    doneRef.current = true;
    router.push("/login");
  }

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (barRef.current) {
      barRef.current.style.transition = reduced ? "width 0.05s linear" : "width 2s linear";
      requestAnimationFrame(() => { if (barRef.current) barRef.current.style.width = "92%"; });
    }
    const stepTimer = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, reduced ? 60 : 620);
    const doneTimer = setTimeout(proceed, reduced ? 250 : 2200);
    return () => { clearInterval(stepTimer); clearTimeout(doneTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mkt mkt-entering">
      <div className="mkt-mesh"><i /><i /><i /></div>
      <div className="mkt-enter-card">
        <div className="mkt-enter-mark"><CheckCircle2 size={36} color="#fff" aria-hidden="true" /></div>
        <div className="mkt-enter-brand">WAYPOINT</div>
        <div className="mkt-enter-bar"><i ref={barRef as React.RefObject<HTMLElement>} /></div>
        <div className="mkt-enter-status" role="status">{STEPS[step]}</div>
        <div style={{ display: "flex", gap: 22, marginTop: 4, color: "rgba(255,255,255,.55)", fontSize: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Lock size={14} aria-hidden="true" />Signed sessions</span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}><ShieldCheck size={14} aria-hidden="true" />Membership-gated trips</span>
        </div>
        <button type="button" className="mkt-enter-skip" onClick={proceed}>Skip →</button>
      </div>
    </div>
  );
}
