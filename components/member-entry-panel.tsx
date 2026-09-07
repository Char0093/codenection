"use client";

import React, { useState } from "react";
import { budgetTiers, paceLevels, type BudgetTier, type PaceLevel } from "@/lib/domain/trip";
import {
  DIETARY_FLAG_LABELS, RELIGIOUS_ACCESS_FLAG_LABELS, MOBILITY_FLAG_LABELS,
} from "@/lib/domain/constraints";
import type { FlagRef } from "@/lib/domain/member-entry";
import type { MemberEntryContext } from "@/app/actions/member-entry";

// Per-trip member entry (spec §2.4 / §3.3): the organizer preview, an aggregate
// non-attributable alignment summary once >=2 members have entered, and the caller's own
// availability / budget / pace / per-trip safety confirm-or-override form.

const FLAG_LABELS: Record<FlagRef["kind"], Record<string, string>> = {
  dietary: DIETARY_FLAG_LABELS,
  religious_access: RELIGIOUS_ACCESS_FLAG_LABELS,
  mobility: MOBILITY_FLAG_LABELS,
};
const flagKey = (ref: FlagRef) => `${ref.kind}:${ref.flag}`;
const flagLabel = (ref: FlagRef) => FLAG_LABELS[ref.kind]?.[ref.flag] ?? ref.flag;

function timeframeLine(preview: MemberEntryContext["preview"]): string {
  if (preview.startDate && preview.endDate) return `${preview.startDate} → ${preview.endDate}`;
  if (preview.plannedDurationDays) return `${preview.plannedDurationDays}-day trip · dates to be set`;
  return "dates to be set";
}

export function MemberEntryPanel({ tripId, initial, onSaved }: {
  tripId: string;
  initial: MemberEntryContext;
  onSaved?: () => void;
}) {
  const { preview, savedSafety, entry, alignment } = initial;

  const [coverage, setCoverage] = useState<"full" | "partial">(entry?.availability.coverage ?? "full");
  const [arrivalDate, setArrivalDate] = useState(entry?.availability.arrivalDate ?? "");
  const [departureDate, setDepartureDate] = useState(entry?.availability.departureDate ?? "");
  const [budgetTier, setBudgetTier] = useState<BudgetTier>(entry?.budgetTier ?? "standard");
  const [pace, setPace] = useState<PaceLevel>(entry?.pace ?? "balanced");
  const [applies, setApplies] = useState<Record<string, boolean>>(() => {
    const overridden = new Set((entry?.safetyOverrides ?? []).map(flagKey));
    return Object.fromEntries(savedSafety.map((ref) => [flagKey(ref), !overridden.has(flagKey(ref))]));
  });

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const availabilityValid = coverage === "full" || Boolean(arrivalDate || departureDate);
  const canSubmit = availabilityValid && !pending;

  function buildBody() {
    return {
      availability: {
        coverage,
        arrivalDate: coverage === "partial" ? (arrivalDate || null) : null,
        departureDate: coverage === "partial" ? (departureDate || null) : null,
      },
      budgetTier,
      pace,
      safetyOverrides: savedSafety.filter((ref) => !applies[flagKey(ref)]),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/member-entry`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) { setSaved(true); onSaved?.(); return; }
      setError(data?.error ?? `Could not save your preferences (${response.status}).`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="member-entry">
      <div className="member-entry-preview">
        <h2>Trip frame</h2>
        <dl>
          <div><dt>Organizer</dt><dd>{preview.organizerName}</dd></div>
          <div><dt>Destination</dt><dd>{preview.destinationName ?? "To be set"}</dd></div>
          <div><dt>When</dt><dd>{timeframeLine(preview)}</dd></div>
          <div><dt>Group</dt><dd>{preview.memberCount} members</dd></div>
          <div><dt>Proposed budget</dt><dd>{preview.proposedBudgetTier ?? "not set"}</dd></div>
          <div><dt>Pace</dt><dd>{preview.pace ?? "not set"}</dd></div>
        </dl>
      </div>

      {alignment && (
        <div className="member-entry-alignment" data-testid="alignment-summary">
          <h2>Group alignment</h2>
          <p className="field-hint">Aggregated across {alignment.memberCount} members — not attributed to anyone.</p>
          <ul>
            <li>Budget: {alignment.budget.min} to {alignment.budget.max}</li>
            <li>
              Pace: {paceLevels.map((level) => `${level.label} ${alignment.pace[level.value] ?? 0}`).join(" · ")}
            </li>
            <li>Availability: {alignment.availability.full} whole-trip · {alignment.availability.partial} part-trip</li>
            {alignment.safetyOverrides.length > 0 && (
              <li>
                Dropped for this trip: {alignment.safetyOverrides
                  .map((override) => `${flagLabel(override as FlagRef)} ×${override.count}`)
                  .join(", ")}
              </li>
            )}
          </ul>
        </div>
      )}

      <form className="member-entry-form" onSubmit={submit}>
        <h2>Your preferences for this trip</h2>

        <fieldset>
          <legend>Your availability</legend>
          <label>
            <input type="radio" name="coverage" checked={coverage === "full"} onChange={() => setCoverage("full")} />
            Whole trip
          </label>
          <label>
            <input type="radio" name="coverage" checked={coverage === "partial"} onChange={() => setCoverage("partial")} />
            Part of it
          </label>
          {coverage === "partial" && (
            <div className="member-entry-dates">
              <label>
                Arrive
                <input type="date" value={arrivalDate} onChange={(event) => setArrivalDate(event.target.value)} />
              </label>
              <label>
                Leave
                <input type="date" value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} />
              </label>
            </div>
          )}
        </fieldset>

        <label>
          Budget tier
          <select value={budgetTier} onChange={(event) => setBudgetTier(event.target.value as BudgetTier)}>
            {budgetTiers.map((tier) => <option key={tier.value} value={tier.value}>{tier.label}</option>)}
          </select>
        </label>

        <label>
          Daily pace
          <select value={pace} onChange={(event) => setPace(event.target.value as PaceLevel)}>
            {paceLevels.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </label>

        <fieldset>
          <legend>Your saved safety requirements</legend>
          {savedSafety.length === 0 ? (
            <p className="field-hint">No saved safety requirements.</p>
          ) : (
            savedSafety.map((ref) => (
              <label key={flagKey(ref)}>
                <input type="checkbox" checked={applies[flagKey(ref)] ?? true}
                  onChange={(event) => setApplies((current) => ({ ...current, [flagKey(ref)]: event.target.checked }))} />
                {flagLabel(ref)} applies to this trip
              </label>
            ))
          )}
        </fieldset>

        {error && <p className="error-notice" role="alert"><span>{error}</span></p>}
        {saved && <p className="inline-notice" role="status"><span>Saved.</span></p>}

        <div className="onboarding-nav">
          <span />
          <button type="submit" className="primary-button" disabled={!canSubmit}>Save your preferences</button>
        </div>
      </form>
    </section>
  );
}
