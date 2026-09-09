"use client";

import React, { useState } from "react";
import { budgetTiers, paceLevels } from "@/lib/domain/trip";
import { DailyRhythm } from "@/features/prototype/daily-rhythm";
import { DEMO_TRIP } from "@/lib/prototype/fixtures";

/** Prototype "Your prefs" (per-trip member entry): the trip frame, your per-trip availability
 *  and budget/pace, plus the new Daily rhythm section. Saving flips a local confirmation only. */
export function DemoMemberEntry() {
  const [coverage, setCoverage] = useState<"full" | "partial">("full");
  const [budgetTier, setBudgetTier] = useState("standard");
  const [pace, setPace] = useState("balanced");
  const [saved, setSaved] = useState(false);

  return (
    <section className="member-entry">
      <div className="member-entry-preview">
        <h2>Trip frame</h2>
        <dl>
          <div><dt>Organizer</dt><dd>{DEMO_TRIP.organizerName}</dd></div>
          <div><dt>Destination</dt><dd>{DEMO_TRIP.destinationName}</dd></div>
          <div><dt>When</dt><dd>{DEMO_TRIP.startDate} → {DEMO_TRIP.endDate}</dd></div>
          <div><dt>Group</dt><dd>{DEMO_TRIP.memberCount} members</dd></div>
          <div><dt>Proposed budget</dt><dd>{DEMO_TRIP.proposedBudgetTier}</dd></div>
          <div><dt>Pace</dt><dd>{DEMO_TRIP.pace}</dd></div>
        </dl>
      </div>

      <form className="member-entry-form" onSubmit={(e) => { e.preventDefault(); setSaved(true); }}>
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
        </fieldset>

        <label>
          Budget tier
          <select value={budgetTier} onChange={(e) => setBudgetTier(e.target.value)}>
            {budgetTiers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <label>
          Daily pace
          <select value={pace} onChange={(e) => setPace(e.target.value)}>
            {paceLevels.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        <DailyRhythm />

        {saved && <p className="inline-notice" role="status"><span>Saved for this session — resets on refresh.</span></p>}
        <div className="onboarding-nav">
          <span />
          <button type="submit" className="primary-button">Save your preferences</button>
        </div>
      </form>
    </section>
  );
}
