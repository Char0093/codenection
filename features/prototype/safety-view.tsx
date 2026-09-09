"use client";

import React, { useState } from "react";
import { Check, LoaderCircle, ScanLine, ShieldAlert, TriangleAlert } from "lucide-react";
import { DEMO_VQA, memberColor, memberName } from "@/lib/prototype/demo-features";

/** A stylised plate — the CSP allows no third-party images, so the sample dish is drawn inline. */
function DishImage() {
  return (
    <svg viewBox="0 0 200 140" className="vqa-dish" role="img" aria-label="Sample photo of a plate of char kway teow">
      <rect width="200" height="140" fill="#efe6d2" />
      <ellipse cx="100" cy="76" rx="72" ry="46" fill="#fff" />
      <ellipse cx="100" cy="76" rx="62" ry="38" fill="#e9dcc0" />
      {/* noodles */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${52 + i * 3} ${64 + i * 4} q24 -12 48 0 t46 -2`} stroke="#c9922f" strokeWidth="4"
          fill="none" strokeLinecap="round" opacity={0.85} />
      ))}
      {/* prawns */}
      <path d="M74 62 q10 -12 22 -4 q-8 10 -22 4Z" fill="#e2704a" />
      <path d="M118 88 q11 -12 23 -3 q-9 10 -23 3Z" fill="#e2704a" />
      {/* cockles */}
      <circle cx="92" cy="94" r="7" fill="#8a5a3b" />
      <circle cx="108" cy="60" r="6" fill="#8a5a3b" />
      {/* greens */}
      <path d="M62 88 q10 -6 18 2" stroke="#5f8a4a" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M128 66 q10 -6 18 2" stroke="#5f8a4a" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Feature: food-safety visual check. The assistant reports what it *thinks* it sees, with
 * confidence; the verdict is then a deterministic read of a confirmed constraint, not the
 * model's opinion. Unknown or low-confidence evidence fails closed — the same rule the
 * itinerary gate uses.
 */
export function SafetyView() {
  const [state, setState] = useState<"idle" | "scanning" | "done">("idle");
  const risky = DEMO_VQA.detected.filter((d) => d.risk);

  function scan() {
    setState("scanning");
    window.setTimeout(() => setState("done"), 1100);
  }

  return (
    <section className="vqa-view">
      <div className="section-heading">
        <div>
          <h1>Check a dish</h1>
          <p className="field-hint">Point the camera at a plate before anyone eats it.</p>
        </div>
      </div>
      <p className="demo-hint">Demo — the photo and the detection result are scripted; the constraint check they feed is the real rule.</p>

      <div className="vqa-card">
        <DishImage />
        <div className="vqa-meta">
          <strong>{DEMO_VQA.dish}</strong>
          <span className="field-hint">{DEMO_VQA.stall}</span>
        </div>
      </div>

      {state === "idle" && (
        <div className="onboarding-nav">
          <span />
          <button type="button" className="primary-button" onClick={scan}>
            <ScanLine aria-hidden="true" />Check this dish
          </button>
        </div>
      )}

      {state === "scanning" && (
        <p className="inline-notice" role="status">
          <LoaderCircle className="spin" aria-hidden="true" />Looking at the plate…
        </p>
      )}

      {state === "done" && (
        <>
          <div className="vqa-verdict" data-verdict={DEMO_VQA.verdict} role="alert">
            <ShieldAlert aria-hidden="true" />
            <div>
              <strong>{DEMO_VQA.headline}</strong>
              <p>{DEMO_VQA.reasoning}</p>
            </div>
          </div>

          <div className="vqa-affected">
            <span className="jig-avatar" style={{ background: memberColor(DEMO_VQA.affectedMemberId) }}>
              {memberName(DEMO_VQA.affectedMemberId).slice(0, 1)}
            </span>
            <span>
              <strong>{memberName(DEMO_VQA.affectedMemberId)}</strong> · confirmed constraint:{" "}
              <em>{DEMO_VQA.constraint}</em>
            </span>
          </div>

          <div className="vqa-detected">
            <h2>What the assistant sees</h2>
            <p className="field-hint">
              Claims about the image, not verified facts about the recipe. {risky.length} of these
              conflict with a confirmed constraint, so the dish is refused rather than flagged as a maybe.
            </p>
            <ul>
              {DEMO_VQA.detected.map((d) => (
                <li key={d.label} data-risk={d.risk ? "true" : undefined}>
                  <span className="vqa-ing">
                    {d.risk ? <TriangleAlert size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                    {d.label}
                  </span>
                  <span className="vqa-conf" aria-hidden="true">
                    <i style={{ width: `${Math.round(d.confidence * 100)}%` }} data-risk={d.risk ? "true" : undefined} />
                  </span>
                  <span className="vqa-conf-num">{Math.round(d.confidence * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="vqa-alt">
            <strong>Instead:</strong> {DEMO_VQA.alternative}
          </p>

          <div className="onboarding-nav">
            <span />
            <button type="button" className="secondary-button" onClick={() => setState("idle")}>Check another dish</button>
          </div>
        </>
      )}
    </section>
  );
}
