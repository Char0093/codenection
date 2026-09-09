"use client";

import React, { useState } from "react";
import { Car, ChevronDown, Footprints, PersonStanding, TramFront } from "lucide-react";
import { ManeuverIcon } from "./maneuver-icon";
import type { DemoRouteLeg } from "@/lib/prototype/fixtures";
import type { DemoMapStop, ModeRoute } from "./types";

const LEG_ICON = { walk: Footprints, drive: Car, funicular: TramFront } as const;

/** The day's stops with the fixture leg between each pair, plus a collapsible turn-by-turn list
 *  from the active mode's live Directions steps. `onLookAround` (when a live map is available)
 *  opens that stop's Street View. */
export function StopList({ stops, legs, activeRoute, onLookAround }: {
  stops: DemoMapStop[];
  legs: DemoRouteLeg[];
  activeRoute: ModeRoute;
  onLookAround?: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = activeRoute.steps ?? [];

  return (
    <div className="map-stoplist">
      <ol>
        {stops.map((stop, index) => {
          const leg = legs.find((l) => l.fromId === stop.id);
          const Icon = leg ? LEG_ICON[leg.mode] : null;
          return (
            <li key={stop.id} className="map-stop" style={{ ["--i" as string]: index }}>
              <div className="map-stop-row">
                <span className="map-stop-num">{stop.order}</span>
                <span className="map-stop-name">{stop.name}</span>
                {onLookAround && (
                  <button type="button" className="map-stop-look"
                    aria-label={`Street view at ${stop.name}`}
                    onClick={() => onLookAround(index)}>
                    <PersonStanding size={14} aria-hidden="true" />
                  </button>
                )}
                <span className="map-stop-time">{stop.time}</span>
              </div>
              {leg && Icon && (
                <div className="map-stop-leg">
                  <span className="map-stop-leg-rail" aria-hidden="true" />
                  <Icon size={12} aria-hidden="true" />
                  {leg.minutes} min {leg.mode} · {leg.distanceKm.toFixed(1)} km
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {steps.length > 0 && (
        <div className="map-steps" data-open={open ? "true" : undefined}>
          <button type="button" className="map-steps-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <ChevronDown size={15} aria-hidden="true" />
            {open ? "Hide" : "Show"} turn-by-turn ({steps.length} steps)
          </button>
          {open && (
            <ol className="map-steps-list">
              {steps.map((step, i) => (
                <li key={i}>
                  <ManeuverIcon maneuver={step.maneuver} instruction={step.instruction}
                    last={i === steps.length - 1} />
                  <span className="map-steps-text">{step.instruction || "Continue"}</span>
                  {step.distanceText && <span className="map-steps-dist">{step.distanceText}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
