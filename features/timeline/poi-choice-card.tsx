"use client";

import React from "react";
import { BadgeCheck, CircleAlert, Clock, Info, ShieldQuestion, Wallet } from "lucide-react";
import type { PoolCandidate } from "@/lib/poi/choice-pool";
import { POOL_CATEGORY_LABELS } from "@/lib/poi/choice-pool";

export const POI_DRAG_MIME = "application/x-wandersync-poi";

function openingLabel(candidate: PoolCandidate): { text: string; tone: "ok" | "warn" | "bad" } {
  switch (candidate.openingStatus.kind) {
    case "open": return { text: "Open on this day", tone: "ok" };
    case "closed_that_day": return { text: "Closed on this day", tone: "bad" };
    case "closed_temporarily": return { text: "Temporarily closed", tone: "bad" };
    case "closed_permanently": return { text: "Permanently closed", tone: "bad" };
    default: return { text: "Hours unverified", tone: "warn" };
  }
}

const TRUST_LABELS: Record<PoolCandidate["trust"], string> = {
  curated: "Verified by WanderSync",
  provider: "From Google Places",
  unverified: "Unverified source",
};

/**
 * One candidate in the choice pool. Owned and provider prose are rendered from separate fields and
 * labelled differently, so provider content is never presented as WanderSync's own
 * (docs/features/provider-adapters.md). A `fail` candidate is not draggable at all -- the Phase 1
 * gate decides eligibility before the drag, not after the drop.
 */
export function PoiChoiceCard({ candidate, onOpenDetails, onSchedule, onDragStateChange }: {
  candidate: PoolCandidate;
  onOpenDetails: () => void;
  onSchedule: () => void;
  onDragStateChange: (candidate: PoolCandidate | null) => void;
}) {
  const blocked = candidate.eligibility.result === "fail";
  const opening = openingLabel(candidate);
  const description = candidate.shortDescription
    ?? (candidate.providerDescription ? `${candidate.providerDescription} (${candidate.attribution ?? "provider"})` : null);

  return (
    <li
      className="poi-card"
      data-blocked={blocked ? "true" : undefined}
      data-trust={candidate.trust}
      draggable={!blocked}
      onDragStart={(event) => {
        if (blocked) return;
        event.dataTransfer.setData(POI_DRAG_MIME, candidate.key);
        event.dataTransfer.setData("text/plain", candidate.key);
        event.dataTransfer.effectAllowed = "copy";
        onDragStateChange(candidate);
      }}
      onDragEnd={() => onDragStateChange(null)}
      aria-label={`${candidate.name}, ${POOL_CATEGORY_LABELS[candidate.category]}, ${opening.text}`}
    >
      <div className="poi-card-head">
        <span className="poi-card-name">{candidate.name}</span>
        <span className="poi-card-category">{POOL_CATEGORY_LABELS[candidate.category]}</span>
      </div>

      {description
        ? <p className="poi-card-description">{description}</p>
        : <p className="poi-card-description poi-card-muted">No description available yet.</p>}

      <div className="poi-card-facts">
        <span><Clock size={11} aria-hidden /> {candidate.defaultDurationMinutes} min</span>
        <span><Wallet size={11} aria-hidden /> {candidate.costTier}</span>
        {/* Phase 4 routing supplies travel time; until then say so rather than invent a number. */}
        <span className="poi-card-muted">Travel time unavailable</span>
      </div>

      <div className="poi-card-badges">
        <span className="poi-badge" data-tone={opening.tone}>{opening.text}</span>
        <span className="poi-badge" data-tone={candidate.trust === "curated" ? "ok" : "warn"}>
          {candidate.trust === "curated" ? <BadgeCheck size={11} aria-hidden /> : <ShieldQuestion size={11} aria-hidden />}
          {TRUST_LABELS[candidate.trust]}
        </span>
        {candidate.servesFood && (
          <span className="poi-badge" data-tone={candidate.halalStatus === "verified" ? "ok" : candidate.halalStatus === "claimed" ? "warn" : "bad"}>
            Halal: {candidate.halalStatus}
          </span>
        )}
        {candidate.eligibility.result === "warn" && (
          <span className="poi-badge" data-tone="warn"><CircleAlert size={11} aria-hidden /> Needs review</span>
        )}
      </div>

      {blocked && (
        <p className="poi-card-blocked" role="note">
          Unavailable for this trip: {candidate.eligibility.reasons[0]?.message ?? "a confirmed constraint rules this out."}
        </p>
      )}

      <div className="poi-card-actions">
        <button type="button" className="poi-card-link" onClick={onOpenDetails}>
          <Info size={12} aria-hidden /> View details
        </button>
        {!blocked && (
          <button type="button" className="poi-card-add" onClick={onSchedule}>Add to day</button>
        )}
      </div>
    </li>
  );
}
