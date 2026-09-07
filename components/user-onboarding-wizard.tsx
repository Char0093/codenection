"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIETARY_FLAGS, DIETARY_FLAG_LABELS,
  RELIGIOUS_ACCESS_FLAGS, RELIGIOUS_ACCESS_FLAG_LABELS,
  MOBILITY_FLAGS, MOBILITY_FLAG_LABELS,
} from "@/lib/domain/constraints";
import {
  SURPRISE_DIAL_DEFAULT, epsilonToSurpriseDial, type OnboardingSnapshot,
} from "@/lib/domain/onboarding";

// Global first-login Travel DNA (spec §2.2, revised 2026-09-07): one safety-vault screen
// plus one OPTIONAL exploration dial. Targets ~10 seconds; picking nothing is fine. This is
// deliberately separate from the frozen five-screen trip-scoped `onboarding-wizard.tsx`.
const SURPRISE_LABELS = ["familiar classics", "mostly familiar", "a balanced mix", "mostly new", "open-ended discovery"];

type Draft = {
  dietary: Set<string>;
  religiousAccess: Set<string>;
  mobility: Set<string>;
  dialSkipped: boolean;
  surpriseDial: number;
};

function draftFrom(snapshot: OnboardingSnapshot): Draft {
  const completed = snapshot.profile?.onboardingCompletedAt != null;
  return {
    dietary: new Set(snapshot.dealbreakers.dietary.confirmed),
    religiousAccess: new Set(snapshot.dealbreakers.religiousAccess.confirmed),
    mobility: new Set(snapshot.dealbreakers.mobility.confirmed),
    dialSkipped: !completed,
    surpriseDial: completed
      ? epsilonToSurpriseDial(snapshot.profile!.serendipityEpsilon)
      : SURPRISE_DIAL_DEFAULT,
  };
}

export function UserOnboardingWizard({ initial, successHref, endpoint = "/api/onboarding" }: {
  initial: OnboardingSnapshot;
  successHref: string;
  endpoint?: string;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [expectedRevision, setExpectedRevision] = useState(initial.profileRevision);
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { headingRef.current?.focus(); }, [step]);

  function reseed(next: OnboardingSnapshot) {
    setSnapshot(next);
    setDraft(draftFrom(next));
    setExpectedRevision(next.profileRevision);
    setStep(1);
    setError(null);
    setStale(false);
  }

  function toggleFlag(key: "dietary" | "religiousAccess" | "mobility", flag: string) {
    setDraft((current) => {
      const nextSet = new Set(current[key]);
      nextSet.has(flag) ? nextSet.delete(flag) : nextSet.add(flag);
      return { ...current, [key]: nextSet };
    });
  }

  function buildAnswers() {
    return {
      dealbreakers: {
        dietary: [...draft.dietary],
        religiousAccess: [...draft.religiousAccess],
        mobility: [...draft.mobility],
      },
      surpriseDial: draft.dialSkipped ? null : draft.surpriseDial,
    };
  }

  async function finish() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
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
      const response = await fetch(endpoint, { cache: "no-store" });
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
    <section className="onboarding" aria-labelledby="user-onboarding-heading">
      <p className="onboarding-progress">
        <span className="onboarding-step-count">Step {step} of 2</span>
      </p>
      <h2 id="user-onboarding-heading" ref={headingRef} tabIndex={-1}>
        {step === 1 ? "Your dietary and access needs" : "How adventurous should suggestions be?"}
      </h2>

      {step === 1 && (
        <div className="onboarding-dealbreakers">
          <p className="field-hint">
            Confirm anything you always need respected on a trip. You can pick nothing and continue —
            you will confirm these again for each trip you join.
          </p>
          <ChipGroup title="Dietary" flags={DIETARY_FLAGS} labels={DIETARY_FLAG_LABELS}
            selected={draft.dietary} confirmed={snapshot.dealbreakers.dietary.confirmed}
            onToggle={(flag) => toggleFlag("dietary", flag)} />
          <ChipGroup title="Religious access" flags={RELIGIOUS_ACCESS_FLAGS} labels={RELIGIOUS_ACCESS_FLAG_LABELS}
            selected={draft.religiousAccess} confirmed={snapshot.dealbreakers.religiousAccess.confirmed}
            onToggle={(flag) => toggleFlag("religiousAccess", flag)} />
          <ChipGroup title="Mobility" flags={MOBILITY_FLAGS} labels={MOBILITY_FLAG_LABELS}
            selected={draft.mobility} confirmed={snapshot.dealbreakers.mobility.confirmed}
            onToggle={(flag) => toggleFlag("mobility", flag)} />
        </div>
      )}

      {step === 2 && (
        <div className="onboarding-dial">
          <label className="onboarding-quick">
            <input type="checkbox" checked={draft.dialSkipped}
              onChange={(event) => setDraft({ ...draft, dialSkipped: event.target.checked })} />
            Skip this — use a balanced default
          </label>
          <label htmlFor="surprise-dial">How far from the familiar should suggestions go?</label>
          <input id="surprise-dial" type="range" min={1} max={5} step={1}
            value={draft.surpriseDial} disabled={draft.dialSkipped}
            aria-valuetext={`${draft.surpriseDial} of 5 — ${SURPRISE_LABELS[draft.surpriseDial - 1]}`}
            onChange={(event) => setDraft({ ...draft, surpriseDial: Number(event.target.value) })} />
          <p aria-hidden="true">
            {draft.dialSkipped
              ? "Balanced default"
              : `${draft.surpriseDial} of 5 — ${SURPRISE_LABELS[draft.surpriseDial - 1]}`}
          </p>
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
        <button type="button" className="secondary-button" disabled={pending || step === 1}
          onClick={() => setStep(1)}>
          Back
        </button>
        {step === 1 ? (
          <button type="button" className="primary-button" disabled={pending} onClick={() => setStep(2)}>
            Next
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={pending} onClick={() => void finish()}>
            Finish
          </button>
        )}
      </div>
    </section>
  );
}

function ChipGroup({ title, flags, labels, selected, confirmed, onToggle }: {
  title: string;
  flags: readonly string[];
  labels: Record<string, string>;
  selected: Set<string>;
  confirmed: string[];
  onToggle: (flag: string) => void;
}) {
  return (
    <fieldset className="onboarding-chip-group">
      <legend>{title}</legend>
      <div className="flag-grid" role="group" aria-label={title}>
        {flags.map((flag) => {
          const isConfirmed = confirmed.includes(flag);
          return (
            <button key={flag} type="button" className="flag-chip"
              aria-pressed={isConfirmed || selected.has(flag)}
              disabled={isConfirmed}
              title={isConfirmed ? "Already saved — editing saved requirements is coming with the preferences editor" : undefined}
              onClick={() => onToggle(flag)}>
              {labels[flag]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
