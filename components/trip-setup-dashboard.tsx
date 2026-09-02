"use client";

import { useMemo, useState } from "react";
import { budgetTiers, paceLevels, type BudgetTier, type PaceLevel } from "@/lib/domain/trip";

export function TripSetupDashboard() {
  const [budgetTier, setBudgetTier] = useState<BudgetTier>("standard");
  const [pace, setPace] = useState<PaceLevel>("balanced");
  const [saved, setSaved] = useState(false);
  const readiness = useMemo(() => (saved ? 75 : 45), [saved]);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <span className="eyebrow">Phase 0 · Foundation</span>
          <h1>Travel together, without losing the plan.</h1>
        </div>
        <p>Set the group’s destination, pace, budget, and safety requirements before the itinerary and Telegram coordinator take over.</p>
      </section>

      <div className="grid">
        <section className="card">
          <div className="card-head"><h2>Create your active trip</h2><span className="status">Demo mode</span></div>
          <form className="form" onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
            <div className="field full"><label htmlFor="name">Trip name</label><input id="name" required defaultValue="Penang Weekend Escape" /></div>
            <div className="field"><label htmlFor="destination">Destination</label><input id="destination" required defaultValue="George Town, Penang" /></div>
            <div className="field"><label htmlFor="currency">Trip currency</label><select id="currency" defaultValue="MYR"><option>MYR</option><option>USD</option><option>SGD</option></select></div>
            <div className="field"><label htmlFor="start">Start date</label><input id="start" type="date" required defaultValue="2026-10-03" /></div>
            <div className="field"><label htmlFor="end">End date</label><input id="end" type="date" required defaultValue="2026-10-05" /></div>
            <div className="field full"><label>Budget tier</label><div className="choice-row">{budgetTiers.map((tier) => <button type="button" className={`choice ${budgetTier === tier.value ? "active" : ""}`} onClick={() => setBudgetTier(tier.value)} key={tier.value}>{tier.label}</button>)}</div></div>
            <div className="field full"><label>Travel pace</label><div className="choice-row">{paceLevels.map((level) => <button type="button" className={`choice ${pace === level.value ? "active" : ""}`} onClick={() => setPace(level.value)} key={level.value}>{level.label}</button>)}</div></div>
            <div className="field full"><label htmlFor="notes">Group notes</label><textarea id="notes" rows={3} placeholder="Example: halal food, low walking distance, afternoon rain fallback." /></div>
            <button className="submit" type="submit">Save trip foundation</button>
          </form>
          {saved && <p className="summary">Trip setup saved locally for the demo. Connect Supabase to persist it, then invite members to complete consented profiles.</p>}
        </section>

        <aside className="side">
          <section className="card"><div className="card-head"><h2>Trip readiness</h2><span>{readiness}%</span></div><div className="readiness"><div className="meter"><div style={{ width: `${readiness}%` }} /></div><ul className="checklist"><li>Core trip details</li><li>Member consent and profiles</li><li>Constraint-aware itinerary</li><li>Telegram group handoff</li></ul></div></section>
          <section className="card notice"><strong>Consent first.</strong><br />Accessibility, health, allergy, halal, and dietary information is optional. It may influence planning only after the traveler grants consent.</section>
        </aside>
      </div>
    </main>
  );
}
