"use client";

import React from "react";
import { DecisionCard } from "@/features/prototype/decision-card";
import { useDemoTripState } from "@/features/prototype/demo-trip-state";

/**
 * Every signal picked up from chat and every Timeline change saved this session, newest first.
 * Local state only (see DemoTripStateProvider) -- nothing here changes the actual plan.
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
      <p className="demo-hint">Demo — chat signals and Timeline changes land here; agreeing or disagreeing is feedback only and resets on refresh.</p>

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
