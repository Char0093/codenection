"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIETARY_FLAGS, DIETARY_FLAG_LABELS,
  RELIGIOUS_ACCESS_FLAGS, RELIGIOUS_ACCESS_FLAG_LABELS,
  MOBILITY_FLAGS, MOBILITY_FLAG_LABELS,
} from "@/lib/domain/constraints";
import { budgetTiers, paceLevels } from "@/lib/domain/trip";
import type { BudgetTier, PaceLevel } from "@/lib/domain/trip";
import {
  TRAVEL_VIBES, TRAVEL_VIBE_LABELS, SURPRISE_DIAL_DEFAULT, epsilonToSurpriseDial,
  type TravelVibe,
} from "@/lib/domain/onboarding";
// TODO(slice-2): replace this whole component with the two-screen safety-first wizard
// (safety vault + optional dial) + an `endpoint` prop. Until then it is the delivered
// trip-scoped five-screen flow and reads the frozen legacy contract.
import {
  SOCIAL_ROLES, SOCIAL_ROLE_LABELS, WALKING_CAP_PRESETS,
  type SocialRole, type LegacyOnboardingSnapshot as OnboardingSnapshot,
} from "@/lib/domain/onboarding-legacy";

type Draft = {
  vibe: TravelVibe | null;
  dietary: Set<string>;
  religiousAccess: Set<string>;
  mobility: Set<string>;
  walkingCapM: number | null;
  budgetLean: BudgetTier;
  pace: PaceLevel;
  socialRole: SocialRole | null;
  surpriseDial: number;
};

const SURPRISE_LABELS = ["stick to the plan", "mostly planned", "balanced", "mostly open", "surprise me"];
const STEP_TITLES: Record<number, string> = {
  1: "What kind of traveler are you?",
  2: "What do you need when you travel?",
  3: "How do you like to travel?",
  4: "What role do you naturally take?",
  5: "How spontaneous are you?",
};

function draftFrom(snapshot: OnboardingSnapshot): Draft {
  const p = snapshot.profile;
  return {
    vibe: p?.travelVibe ?? null,
    dietary: new Set(snapshot.dealbreakers.dietary.confirmed),
    religiousAccess: new Set(snapshot.dealbreakers.religiousAccess.confirmed),
    mobility: new Set(snapshot.dealbreakers.mobility.confirmed),
    walkingCapM: p?.mobilityThresholdM ?? null,
    budgetLean: (p?.budgetLean ?? "standard") as BudgetTier,
    pace: (p?.pace ?? "balanced") as PaceLevel,
    socialRole: p?.socialRole ?? null,
    surpriseDial: p?.onboardingCompletedAt == null ? SURPRISE_DIAL_DEFAULT : epsilonToSurpriseDial(p.serendipityEpsilon),
  };
}

export function OnboardingWizard({ tripId, initial, successHref }: {
  tripId: string;
  initial: OnboardingSnapshot;
  successHref: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"full" | "quick">("full");
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [expectedRevision, setExpectedRevision] = useState(initial.profileRevision);
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const steps = mode === "quick" ? [2, 3] : [1, 2, 3, 4, 5];
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;

  useEffect(() => { headingRef.current?.focus(); }, [step, mode]);

  const canAdvance =
    mode === "quick" ? true
    : step === 1 ? draft.vibe !== null
    : step === 4 ? draft.socialRole !== null
    : true;

  function reseed(snapshot: OnboardingSnapshot) {
    setSnapshot(snapshot);
    setDraft(draftFrom(snapshot));
    setExpectedRevision(snapshot.profileRevision);
    setStepIndex(0);
    setError(null);
    setStale(false);
  }

  function toggleFlag(key: "dietary" | "religiousAccess" | "mobility", flag: string) {
    setDraft((current) => {
      const next = new Set(current[key]);
      next.has(flag) ? next.delete(flag) : next.add(flag);
      return { ...current, [key]: next };
    });
  }

  function buildAnswers() {
    const dealbreakers = {
      dietary: [...draft.dietary],
      religiousAccess: [...draft.religiousAccess],
      mobility: [...draft.mobility],
    };
    if (mode === "quick") {
      return { mode: "quick" as const, dealbreakers, walkingCapM: draft.walkingCapM, budgetLean: draft.budgetLean };
    }
    return {
      mode: "full" as const, dealbreakers, walkingCapM: draft.walkingCapM, budgetLean: draft.budgetLean,
      vibe: draft.vibe, pace: draft.pace, socialRole: draft.socialRole, surpriseDial: draft.surpriseDial,
    };
  }

  async function finish() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/onboarding`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision, answers: buildAnswers() }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) { router.replace(successHref); return; }
      if (data?.code === "STALE_PROFILE") { setStale(true); setError(data.error ?? "Your preferences changed elsewhere."); return; }
      setError(data?.error ?? `Could not save your answers (${response.status}).`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    setPending(true);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/onboarding`, { cache: "no-store" });
      const data = (await response.json()) as OnboardingSnapshot;
      if (response.ok) reseed(data);
      else setError("Reload failed. Refresh the page and try again.");
    } catch {
      setError("Reload failed. Refresh the page and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="onboarding" aria-labelledby="onboarding-heading">
      <p className="onboarding-progress">
        {mode === "quick" ? <span className="onboarding-badge">Quick</span> : null}
        <span className="onboarding-step-count">Step {stepIndex + 1} of {steps.length}</span>
      </p>
      <h2 id="onboarding-heading" ref={headingRef} tabIndex={-1}>{STEP_TITLES[step]}</h2>

      {step === 1 && (
        <fieldset className="onboarding-cards">
          <legend className="field-hint">Choose the travel style you generally enjoy most.</legend>
          {TRAVEL_VIBES.map((vibe) => (
            <label key={vibe} className="onboarding-card">
              <input type="radio" name="vibe" checked={draft.vibe === vibe}
                onChange={() => setDraft({ ...draft, vibe })} />
              <span>{TRAVEL_VIBE_LABELS[vibe]}</span>
            </label>
          ))}
          <label className="onboarding-quick">
            <input type="checkbox" checked={mode === "quick"}
              onChange={(event) => { setMode(event.target.checked ? "quick" : "full"); setStepIndex(0); }} />
            Quick mode — dealbreakers and budget only
          </label>
        </fieldset>
      )}

      {step === 2 && (
        <div className="onboarding-dealbreakers">
          <p className="field-hint">
            Select anything you generally need respected when you travel. You can add more later.
            Removing a dietary flag is done on the trip dashboard; religious-access and mobility flags
            become editable when constraint review ships.
          </p>
          <ChipGroup title="Dietary" flags={DIETARY_FLAGS} labels={DIETARY_FLAG_LABELS}
            selected={draft.dietary} existing={snapshot.dealbreakers.dietary}
            onToggle={(flag) => toggleFlag("dietary", flag)} />
          <ChipGroup title="Religious access" flags={RELIGIOUS_ACCESS_FLAGS} labels={RELIGIOUS_ACCESS_FLAG_LABELS}
            selected={draft.religiousAccess} existing={snapshot.dealbreakers.religiousAccess}
            onToggle={(flag) => toggleFlag("religiousAccess", flag)} />
          <ChipGroup title="Mobility" flags={MOBILITY_FLAGS} labels={MOBILITY_FLAG_LABELS}
            selected={draft.mobility} existing={snapshot.dealbreakers.mobility}
            onToggle={(flag) => toggleFlag("mobility", flag)} />
          <fieldset className="onboarding-walking">
            <legend>Your comfortable walking distance between stops</legend>
            <div className="segmented">
              {WALKING_CAP_PRESETS.map((preset) => (
                <label key={String(preset.value)}>
                  <input type="radio" name="walkingCap" checked={draft.walkingCapM === preset.value}
                    onChange={() => setDraft({ ...draft, walkingCapM: preset.value })} />
                  <span>{preset.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {step === 3 && (
        <div className="onboarding-sliders">
          <fieldset>
            <legend>Usual budget style</legend>
            <div className="segmented">
              {budgetTiers.map((tier) => (
                <label key={tier.value}>
                  <input type="radio" name="budgetLean" checked={draft.budgetLean === tier.value}
                    onChange={() => setDraft({ ...draft, budgetLean: tier.value })} />
                  <span>{tier.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "full" && (
            <fieldset>
              <legend>Preferred daily pace</legend>
              <div className="segmented">
                {paceLevels.map((level) => (
                  <label key={level.value}>
                    <input type="radio" name="pace" checked={draft.pace === level.value}
                      onChange={() => setDraft({ ...draft, pace: level.value })} />
                    <span>{level.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {step === 4 && (
        <fieldset className="onboarding-roles">
          <legend className="field-hint">Only you can see this — it never appears to other members.</legend>
          {SOCIAL_ROLES.map((role) => (
            <label key={role} className="onboarding-role">
              <input type="radio" name="socialRole" checked={draft.socialRole === role}
                onChange={() => setDraft({ ...draft, socialRole: role })} />
              <span>{SOCIAL_ROLE_LABELS[role]}</span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 5 && (
        <div className="onboarding-dial">
          <label htmlFor="surprise-dial">Slide toward how you usually like to travel.</label>
          <input id="surprise-dial" type="range" min={1} max={5} step={1} value={draft.surpriseDial}
            aria-valuetext={`${draft.surpriseDial} of 5 — ${SURPRISE_LABELS[draft.surpriseDial - 1]}`}
            onChange={(event) => setDraft({ ...draft, surpriseDial: Number(event.target.value) })} />
          <p aria-hidden="true">{draft.surpriseDial} of 5 — {SURPRISE_LABELS[draft.surpriseDial - 1]}</p>
        </div>
      )}

      {error && (
        <p className="error-notice" role="alert">
          <span>{error}</span>
          {stale && (
            <button type="button" className="secondary-button" disabled={pending} onClick={() => void reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <div className="onboarding-nav">
        <button type="button" className="secondary-button"
          disabled={pending || (mode === "full" && stepIndex === 0)}
          onClick={() => {
            if (mode === "quick" && stepIndex === 0) {
              setMode("full");
              setStepIndex(0);
            } else {
              setStepIndex((index) => Math.max(0, index - 1));
            }
          }}>
          Back
        </button>
        {isLast ? (
          <button type="button" className="primary-button" disabled={pending || !canAdvance} onClick={() => void finish()}>
            Finish
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={pending || !canAdvance}
            onClick={() => setStepIndex((index) => index + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}

function ChipGroup({ title, flags, labels, selected, existing, onToggle }: {
  title: string;
  flags: readonly string[];
  labels: Record<string, string>;
  selected: Set<string>;
  existing: { confirmed: string[]; pending: string[] };
  onToggle: (flag: string) => void;
}) {
  return (
    <fieldset className="onboarding-chip-group">
      <legend>{title}</legend>
      <div className="flag-grid" role="group" aria-label={title}>
        {flags.map((flag) => {
          const confirmed = existing.confirmed.includes(flag);
          const pending = existing.pending.includes(flag);
          const locked = confirmed || pending;
          return (
            <button key={flag} type="button" className="flag-chip"
              aria-pressed={confirmed || selected.has(flag)}
              disabled={locked}
              title={confirmed
                ? (title === "Dietary"
                    ? "Already set — remove it under Dietary conditions on the trip dashboard"
                    : "Already set — removing this needs constraint review, coming with Task 1.3")
                : pending ? "Suggested — review coming soon" : undefined}
              onClick={() => onToggle(flag)}>
              {labels[flag]}{pending ? " (suggested)" : ""}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
