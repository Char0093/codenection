"use client";

import React, { useMemo, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import {
  POOL_CATEGORIES,
  POOL_CATEGORY_LABELS,
  candidatesInCategory,
  searchCandidates,
  type PoolCandidate,
  type PoolCategory,
} from "@/lib/poi/choice-pool";
import { PoiChoiceCard } from "@/features/timeline/poi-choice-card";

/**
 * Task 3.4's categorized choice pool: a side panel on desktop, a bottom drawer below the tablet
 * breakpoint (see `.poi-pool` in app/globals.css). Categories come from the deterministic canonical
 * mapping in lib/poi/choice-pool.ts -- nothing here asks a model to classify at render time.
 */
export function PoiChoicePool({ candidates, loading, error, onOpenDetails, onSchedule, onUnscheduleDrop, poolDropActive, onDragStateChange }: {
  candidates: readonly PoolCandidate[];
  loading: boolean;
  error: string | null;
  onOpenDetails: (candidate: PoolCandidate) => void;
  onSchedule: (candidate: PoolCandidate) => void;
  /** A scheduled block dragged back onto the pool is unscheduled, never deleted from the catalog. */
  onUnscheduleDrop: (itemId: string) => void;
  poolDropActive: boolean;
  /** Drives the timeline's feasible-range shading while a card is in flight. */
  onDragStateChange: (candidate: PoolCandidate | null) => void;
}) {
  const [category, setCategory] = useState<PoolCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const visible = useMemo(
    () => searchCandidates(candidatesInCategory(candidates, category), query),
    [candidates, category, query],
  );
  const available = visible.filter((candidate) => candidate.eligibility.result !== "fail");
  const unavailable = visible.filter((candidate) => candidate.eligibility.result === "fail");

  return (
    <section
      className="poi-pool"
      aria-label="Place choices"
      data-drop-target={poolDropActive ? "true" : undefined}
      data-drag-over={dragOver ? "true" : undefined}
      onDragOver={(event) => {
        if (!poolDropActive) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        setDragOver(false);
        const itemId = event.dataTransfer.getData("text/plain");
        if (itemId) {
          event.preventDefault();
          onUnscheduleDrop(itemId);
        }
      }}
    >
      <div className="poi-pool-controls">
        <label className="poi-pool-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search places"
            aria-label="Search places"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="poi-pool-tabs" role="tablist" aria-label="Place categories">
          <button type="button" role="tab" aria-selected={category === "all"} data-selected={category === "all" ? "true" : undefined} onClick={() => setCategory("all")}>All</button>
          {POOL_CATEGORIES.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={category === option}
              data-selected={category === option ? "true" : undefined}
              onClick={() => setCategory(option)}
            >
              {POOL_CATEGORY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="inline-notice" role="status"><LoaderCircle className="spin" aria-hidden />Loading places...</p>}
      {error && <p className="error-notice" role="alert">{error}</p>}

      {!loading && !error && (
        <>
          {available.length === 0
            ? <p className="poi-pool-empty">No places match here yet. Only the reference corridor has curated places.</p>
            : <ul className="poi-pool-list">
                {available.map((candidate) => (
                  <PoiChoiceCard
                    key={candidate.key}
                    candidate={candidate}
                    onOpenDetails={() => onOpenDetails(candidate)}
                    onSchedule={() => onSchedule(candidate)}
                    onDragStateChange={onDragStateChange}
                  />
                ))}
              </ul>}

          {unavailable.length > 0 && (
            <div className="poi-pool-unavailable">
              <button type="button" className="poi-pool-toggle" aria-expanded={showUnavailable} onClick={() => setShowUnavailable((value) => !value)}>
                {showUnavailable ? "Hide" : "Show"} {unavailable.length} unavailable {unavailable.length === 1 ? "place" : "places"}
              </button>
              {showUnavailable && (
                <ul className="poi-pool-list">
                  {unavailable.map((candidate) => (
                    <PoiChoiceCard
                      key={candidate.key}
                      candidate={candidate}
                      onOpenDetails={() => onOpenDetails(candidate)}
                      onSchedule={() => onSchedule(candidate)}
                      onDragStateChange={onDragStateChange}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
