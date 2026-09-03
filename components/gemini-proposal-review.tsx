"use client";

import React, { useEffect, useId, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

export type GeminiProposalReviewProps = {
  proposal: ProposalRecord;
  active?: boolean;
  canDecide?: boolean;
  outdated?: boolean;
  busy?: boolean;
  onDecision?: (decision: "accept" | "reject") => void;
};

export function GeminiProposalReview({ proposal, active = false, canDecide = false, outdated = false, busy = false, onDecision }: GeminiProposalReviewProps) {
  const headingId = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (proposal.status !== "pending") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [proposal.id, proposal.status, proposal.expiresAt]);
  const expired = !Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= now;
  const status = proposal.status === "pending" && expired ? "expired" : proposal.status;
  const pending = status === "pending" && !outdated;
  const title = active ? "Active itinerary" : "Itinerary proposal";
  const statusLabel = active ? "Active" : status === "pending" && outdated ? "Outdated" : status[0].toUpperCase() + status.slice(1);

  return <section className={`proposal-review${active ? " active-review" : ""}`} aria-labelledby={headingId}>
    <div className="proposal-heading"><h2 id={headingId}>{title}</h2><span className={`proposal-status ${active ? "accepted" : status}`}>{statusLabel}</span></div>
    <p className="proposal-summary">{proposal.payload.summary}</p>
    <ol className="activity-list">
      {proposal.payload.activities.map((activity, index) => <li key={`${activity.date}-${activity.startTime}-${index}`}>
        <div className="activity-schedule"><time dateTime={activity.date}>{activity.date}</time><span><Clock aria-hidden="true" /><time dateTime={`${activity.date}T${activity.startTime}`}>{activity.startTime}</time> / {activity.durationMinutes} min</span></div>
        <h3>{activity.title}</h3>
        <div className="activity-meta"><span>{activity.category}</span><span>Estimated cost: {activity.estimatedCostTier}</span></div>
        <p>{activity.rationale}</p>
        {activity.contingencyNote && <p className="contingency-note">{activity.contingencyNote}</p>}
      </li>)}
    </ol>
    {proposal.payload.assumptions.length > 0 && <div className="assumptions"><h3>Assumptions</h3><ul>{proposal.payload.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></div>}
    {!active && pending && <p className="expiry-label">Expires <time dateTime={proposal.expiresAt}>{new Date(proposal.expiresAt).toLocaleString()}</time></p>}
    {!active && proposal.status === "pending" && canDecide && onDecision && <div className="form-actions">
      {pending && <button type="button" className="primary-button" disabled={busy} onClick={() => onDecision("accept")}><Check aria-hidden="true" />Confirm itinerary</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision("reject")}><X aria-hidden="true" />Reject</button>
    </div>}
  </section>;
}
