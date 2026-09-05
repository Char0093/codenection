"use client";

import React from "react";
import { X } from "lucide-react";
import type { PoolCandidate } from "@/lib/poi/choice-pool";
import { POOL_CATEGORY_LABELS } from "@/lib/poi/choice-pool";
import { openIntervalsForDate } from "@/lib/poi/opening-hours";
import { minutesToTime } from "@/features/timeline/calendar-geometry";

/**
 * The full record behind a pool card: owned description, provider description (attributed
 * separately, never merged into the owned one), sources, links, verification date, hours, and
 * warnings. Timeline blocks and pool cards stay one line; everything long lives here.
 */
export function PoiDetailSheet({ candidate, selectedDate, onClose }: {
  candidate: PoolCandidate;
  selectedDate: string;
  onClose: () => void;
}) {
  const intervals = candidate.openingStatus.kind === "open"
    ? candidate.openingStatus.intervals
    : openIntervalsForDate(null, selectedDate);

  return (
    <aside className="poi-detail" role="dialog" aria-label={`${candidate.name} details`} aria-modal="false">
      <header className="poi-detail-head">
        <h3>{candidate.name}</h3>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          <X size={16} aria-hidden />
        </button>
      </header>

      <p className="poi-detail-category">{POOL_CATEGORY_LABELS[candidate.category]}</p>

      {candidate.shortDescription && (
        <section>
          <h4>About</h4>
          <p>{candidate.shortDescription}</p>
        </section>
      )}

      {candidate.providerDescription && (
        <section>
          <h4>From the provider</h4>
          <p>{candidate.providerDescription}</p>
          <p className="poi-detail-attribution">{candidate.attribution ?? "Provider content"}</p>
        </section>
      )}

      <section>
        <h4>Opening hours for {selectedDate}</h4>
        {candidate.openingStatus.kind === "open" && intervals.length > 0 ? (
          <ul className="poi-detail-hours">
            {intervals.map((interval) => (
              <li key={interval.startMinute}>{minutesToTime(interval.startMinute)}&ndash;{minutesToTime(interval.endMinute)}</li>
            ))}
          </ul>
        ) : candidate.openingStatus.kind === "closed_that_day" ? (
          <p>Closed on this day.</p>
        ) : candidate.openingStatus.kind === "closed_permanently" ? (
          <p>Reported permanently closed.</p>
        ) : candidate.openingStatus.kind === "closed_temporarily" ? (
          <p>Reported temporarily closed.</p>
        ) : (
          <p className="poi-detail-warning">Hours unverified — confirm before visiting.</p>
        )}
      </section>

      {candidate.servesFood && (
        <section>
          <h4>Dietary evidence</h4>
          <p>Halal status: {candidate.halalStatus}.</p>
          <p>
            {candidate.allergenDataUnknown
              ? "No verified allergen information. Treat unknown allergen data as unknown, not as safe."
              : `Recorded allergen risks: ${candidate.allergenRisk.length > 0 ? candidate.allergenRisk.join(", ") : "none recorded"}.`}
          </p>
        </section>
      )}

      {candidate.eligibility.reasons.length > 0 && (
        <section>
          <h4>Warnings</h4>
          <ul className="poi-detail-warnings">
            {candidate.eligibility.reasons.map((reason) => (
              <li key={reason.dimension + reason.message}>{reason.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>Sources</h4>
        <ul className="poi-detail-sources">
          {candidate.officialUrl && (
            <li><a href={candidate.officialUrl} target="_blank" rel="noreferrer noopener">Official site</a></li>
          )}
          {candidate.googleMapsUri && (
            <li><a href={candidate.googleMapsUri} target="_blank" rel="noreferrer noopener">Google Maps listing</a></li>
          )}
          {candidate.sourceUrl && (
            <li><a href={candidate.sourceUrl} target="_blank" rel="noreferrer noopener">Safety-data source</a></li>
          )}
          {!candidate.officialUrl && !candidate.googleMapsUri && !candidate.sourceUrl && <li>No links recorded.</li>}
        </ul>
        {candidate.sourceNote && <p className="poi-detail-note">{candidate.sourceNote}</p>}
        <p className="poi-detail-note">
          {candidate.verifiedAt ? `Verified ${candidate.verifiedAt}.` : "Not independently verified."}
        </p>
      </section>
    </aside>
  );
}
