"use client";

import React, { useState } from "react";
import { GeminiProposalReview } from "@/components/gemini-proposal-review";
import { useDemoTripState } from "@/features/prototype/demo-trip-state";
import { buildPlanActivities } from "@/lib/prototype/build-plan-activities";
import { DEMO_PROPOSAL } from "@/lib/prototype/fixtures";

/** Prototype Plan tab: the real proposal-review card over the itinerary the group has actually
 *  agreed to (DemoTripStateProvider's `planBlocks`), plus the one AI-proposed activity that never
 *  got a Timeline slot (see the comment on DEMO_PROPOSAL). Accept/reject flips local state only. */
export function DemoPlan() {
  const { planBlocks } = useDemoTripState();
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");
  const activities = [...buildPlanActivities(planBlocks), ...DEMO_PROPOSAL.payload.activities];
  const proposal = { ...DEMO_PROPOSAL, status, payload: { ...DEMO_PROPOSAL.payload, activities } };

  return (
    <>
      {status === "accepted"
        ? <GeminiProposalReview proposal={proposal} active />
        : <GeminiProposalReview
            proposal={proposal}
            canDecide={status === "pending"}
            busy={false}
            onDecision={(decision) => setStatus(decision === "accept" ? "accepted" : "rejected")}
          />}
      <p className="demo-hint" role="status">
        {status === "pending" && "Demo — confirming or rejecting here won't be saved."}
        {status === "accepted" && "Marked active for this session only — resets on refresh."}
        {status === "rejected" && "Rejected for this session only — refresh to restore."}
      </p>
    </>
  );
}
