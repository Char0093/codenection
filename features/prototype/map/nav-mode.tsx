"use client";

import React, { useEffect } from "react";
import { Flag, Gauge, Pause, Play, X } from "lucide-react";
import { ManeuverIcon } from "./maneuver-icon";
import type { RouteStep } from "./types";
import type { NavSim } from "./use-nav-sim";

/**
 * Turn-by-turn navigation over the live map. There is no GPS in this demo, so a simulated
 * "you are here" dot glides along the actual route on its own (see `useNavSim` / the map's live
 * dot overlay) rather than waiting for the traveller to tap through each step. This overlay is
 * the transport for that: the current manoeuvre, a draggable progress scrubber, play/pause,
 * playback speed, and a real-paced ETA. Exiting restores the route screen untouched.
 */
export function NavMode({ steps, sim, destination, onExit }: {
  steps: RouteStep[];
  sim: NavSim;
  destination: string;
  onExit: () => void;
}) {
  const { stepIndex, progress, playing, arrived, speed, remainingText, etaText, toggle, seek, cycleSpeed } = sim;
  const step = steps[stepIndex];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onExit();
      if (e.key === " ") { e.preventDefault(); toggle(); }
      if (e.key === "ArrowRight") seek(Math.min(1, progress + 0.04));
      if (e.key === "ArrowLeft") seek(Math.max(0, progress - 0.04));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, toggle, seek, progress]);

  function onScrubDown(event: React.PointerEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    const fractionAt = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      return rect.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };
    seek(fractionAt(event.clientX));
    function onMove(e: PointerEvent) { seek(fractionAt(e.clientX)); }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="nav-mode" role="dialog" aria-label="Turn-by-turn navigation">
      {/* Current manoeuvre — keyed on the step so a new instruction replays the drop-in cue. */}
      <div className="nav-card" data-last={arrived ? "true" : undefined} key={stepIndex}>
        <ManeuverIcon maneuver={step?.maneuver} instruction={step?.instruction ?? ""} last={arrived} size={26} />
        <div className="nav-card-text">
          <strong>{arrived ? "You've arrived" : (step?.instruction || "Continue")}</strong>
          {!arrived && step?.distanceText && <span>{step.distanceText}</span>}
        </div>
        <button type="button" className="map-fab" aria-label="Exit navigation" onClick={onExit}>
          <X aria-hidden="true" />
        </button>
      </div>

      {/* Scrubber + playback */}
      <div className="nav-bar" data-arrived={arrived ? "true" : undefined}>
        <div
          className="nav-scrub"
          onPointerDown={onScrubDown}
          role="slider"
          tabIndex={0}
          aria-label="Navigation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <i className="nav-scrub-fill" style={{ width: `${progress * 100}%` }} />
          <i className="nav-scrub-thumb" style={{ left: `${progress * 100}%` }} />
        </div>

        <div className="nav-bar-row">
          {arrived ? (
            <>
              <span className="nav-eta" role="status" aria-live="polite">
                <strong>Arrived</strong>
                <span>{destination}</span>
              </span>
              <button type="button" className="primary-button" onClick={onExit}>
                <Flag aria-hidden="true" />Finish
              </button>
            </>
          ) : (
            <>
              <button type="button" className="nav-play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </button>
              <span className="nav-eta" role="status" aria-live="polite">
                <strong>{remainingText}</strong>
                <span>{etaText}</span>
              </span>
              <button type="button" className="nav-speed" onClick={cycleSpeed}
                aria-label={`Playback speed ${speed}x. Activate to change.`}>
                <Gauge aria-hidden="true" size={14} />{speed}×
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
