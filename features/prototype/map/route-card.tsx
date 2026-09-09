"use client";

import React from "react";
import { ArrowUpDown, MoreVertical } from "lucide-react";
import type { DemoMapStop } from "./types";

/**
 * The floating card at the top of the map — origin → destination with a connector, mirroring
 * Google Maps' search/route card — plus the day switcher below it. The reverse / overflow
 * buttons are demo-decorative.
 */
export function RouteCard({ stops, dates, selectedDate, onSelectDate }: {
  stops: DemoMapStop[];
  dates: readonly string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const origin = stops[0]?.name ?? "—";
  const destination = stops[stops.length - 1]?.name ?? "—";

  return (
    <div className="map-topcard">
      <div className="map-routecard">
        <div className="map-routecard-rail" aria-hidden="true">
          <span className="dot dot-origin" />
          <span className="rail-line" />
          <span className="dot dot-dest" />
        </div>
        <div className="map-routecard-fields">
          <span className="map-routecard-field">{origin}</span>
          <span className="map-routecard-sep" />
          <span className="map-routecard-field">{destination}</span>
        </div>
        <div className="map-routecard-actions">
          <button type="button" className="icon-button" aria-label="Reverse route (demo)" tabIndex={-1}>
            <ArrowUpDown aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="More (demo)" tabIndex={-1}>
            <MoreVertical aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="map-daychips" role="tablist" aria-label="Trip day">
        {dates.map((date, i) => (
          <button
            key={date}
            type="button"
            role="tab"
            aria-selected={date === selectedDate}
            className="map-daychip"
            data-active={date === selectedDate ? "true" : undefined}
            onClick={() => onSelectDate(date)}
          >
            Day {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
