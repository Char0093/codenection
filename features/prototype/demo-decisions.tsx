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
    <ul className="decisions-list">
      {[...decisions].reverse().map((decision) => (
        <DecisionCard key={decision.id} decision={decision} onRespond={respondToDecision} />
      ))}
    </ul>
  );
}
