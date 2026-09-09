"use client";

import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight, Flag, X } from "lucide-react";
import { ManeuverIcon } from "./maneuver-icon";
import type { RouteStep } from "./types";

/**
 * Turn-by-turn navigation over the live map. Deliberately step-through rather than GPS-driven:
 * there is no location permission in the demo, so the traveller advances each step and the map
 * follows (RouteScreen pans to `steps[index]`). Exiting restores the route screen untouched.
 */
export function NavMode({ steps, index, destination, onIndex, onExit }: {
  steps: RouteStep[];
  index: number;
  destination: string;
  onIndex: (next: number) => void;
  onExit: () => void;
}) {
  const step = steps[index];
  const last = index === steps.length - 1;
  const progress = steps.length > 1 ? (index / (steps.length - 1)) * 100 : 100;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onExit();
      if (e.key === "ArrowRight" && index < steps.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, onIndex, onExit]);

  return (
    <div className="nav-mode" role="dialog" aria-label="Turn-by-turn navigation">
      {/* Current manoeuvre */}
      <div className="nav-card" data-last={last ? "true" : undefined}>
        <ManeuverIcon maneuver={step?.maneuver} instruction={step?.instruction ?? ""} last={last} size={26} />
        <div className="nav-card-text">
          <strong>{step?.instruction || "Continue"}</strong>
          {step?.distanceText && <span>{step.distanceText}</span>}
        </div>
        <button type="button" className="map-fab" aria-label="Exit navigation" onClick={onExit}>
          <X aria-hidden="true" />
        </button>
      </div>

      {/* Progress + controls */}
      <div className="nav-bar">
        <div className="nav-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
        <div className="nav-bar-row">
          <button type="button" className="secondary-button" disabled={index === 0}
            onClick={() => onIndex(index - 1)}>
            <ChevronLeft aria-hidden="true" />Back
          </button>

          <span className="nav-count" role="status" aria-live="polite">
            {last ? `Arrived · ${destination}` : `Step ${index + 1} of ${steps.length}`}
          </span>

          {last ? (
            <button type="button" className="primary-button" onClick={onExit}>
              <Flag aria-hidden="true" />Finish
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => onIndex(index + 1)}>
              Next<ChevronRight aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
