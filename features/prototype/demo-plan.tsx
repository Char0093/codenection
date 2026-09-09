"use client";

import React, { useState } from "react";
import { GeminiProposalReview } from "@/components/gemini-proposal-review";
import { DEMO_PROPOSAL } from "@/lib/prototype/fixtures";

/** Prototype Plan tab: the real proposal-review card over the fixture itinerary. Accept/reject
 *  flips local state only. */
export function DemoPlan() {
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");
  const proposal = { ...DEMO_PROPOSAL, status };

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
