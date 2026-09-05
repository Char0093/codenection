import React from "react";
import { GeminiProposalReview } from "@/components/gemini-proposal-review";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

export function AssistantProposalCard({ proposal, active, canDecide, busy, onDecision }: {
  proposal: ProposalRecord | undefined;
  active?: boolean;
  canDecide?: boolean;
  busy?: boolean;
  onDecision?: (decision: "accept" | "reject") => void;
}) {
  if (!proposal) {
    return <p className="assistant-proposal-missing">This suggestion is no longer available.</p>;
  }
  return <div className="assistant-proposal-card">
    <GeminiProposalReview proposal={proposal} active={active} canDecide={canDecide} busy={busy} onDecision={onDecision} />
  </div>;
}
