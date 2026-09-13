"use client";

import React from "react";
import { DecisionCard } from "@/features/prototype/decision-card";
import { useDemoTripState } from "@/features/prototype/demo-trip-state";

/**
 * Every signal picked up from chat and every Timeline change saved this session, newest first.
 * Local state only (see DemoTripStateProvider). Agreeing to a signal is feedback only, but
 * agreeing to a Timeline change also updates that stop on the Plan tab (other members are assumed
 * to agree too, for this prototype) -- see DemoTripStateProvider.respondToDecision.
 */
export function DemoDecisions() {
  const { decisions, respondToDecision } = useDemoTripState();
  return (
    <section className="decisions-view">
      <div className="section-heading">
        <div>
          <h1>Decisions</h1>
          <p className="field-hint">{decisions.length} to review</p>
        </div>
      </div>
      <p className="demo-hint">Demo — chat signals and Timeline changes land here. Agreeing to a Timeline change also updates the Plan tab; everything resets on refresh.</p>

      {decisions.length === 0 ? (
        <p className="decisions-empty">No decisions yet.</p>
      ) : (
        <ul className="decisions-list">
          {[...decisions].reverse().map((decision) => (
            <DecisionCard key={decision.id} decision={decision} onRespond={respondToDecision} />
          ))}
        </ul>
      )}
    </section>
  );
}
