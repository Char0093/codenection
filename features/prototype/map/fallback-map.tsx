"use client";

import React from "react";
import type { DemoMapStop } from "./types";

/**
 * Shown when there is no Google Maps key (or it failed): a stylised canvas with the day's stops
 * as numbered pins and a route line that draws itself in. Keeps the screen looking intentional
 * so the rest of the chrome (card, sheet, controls) still makes sense.
 */
export function FallbackMap({ stops }: { stops: DemoMapStop[] }) {
  const points = stops.map((s) => `${s.x},${s.y}`).join(" ");
  return (
    <div className="map-layer-canvas map-layer-fallback" role="img"
      aria-label={`Stylised map of ${stops.length} stops`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <polyline className="fallback-route" points={points} fill="none" stroke="#182544"
          strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.8 1.4" />
        {stops.map((s, i) => (
          <g key={s.id} className="fallback-pin" style={{ ["--i" as string]: i }}>
            <circle cx={s.x} cy={s.y} r="3" fill="#182544" stroke="#fff" strokeWidth="0.6" />
            <text x={s.x} y={s.y + 1} textAnchor="middle" fontSize="3" fontWeight="700" fill="#fff">{s.order}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
