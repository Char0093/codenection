"use client";

import React from "react";
import type { DemoRouteLeg } from "@/lib/prototype/fixtures";
import type { DemoMapStop } from "./types";

const CONGESTION_VAR: Record<NonNullable<DemoRouteLeg["congestion"]>, string> = {
  low: "var(--consensus)", medium: "var(--flexible)", high: "var(--error)",
};

/**
 * Shown when there is no Google Maps key (or it failed): a stylised canvas with the day's stops
 * as numbered pins and a route that draws itself in leg by leg, tinted by the same demo
 * congestion data the live map colours, so the fallback reads as the same product, not a
 * placeholder. Keeps the screen looking intentional so the rest of the chrome still makes sense.
 */
export function FallbackMap({ stops, legs }: { stops: DemoMapStop[]; legs: DemoRouteLeg[] }) {
  const segments = stops.slice(1).map((s, i) => {
    const from = stops[i];
    const leg = legs.find((l) => l.fromId === from.id && l.toId === s.id);
    return { key: `${from.id}-${s.id}`, from, to: s, congestion: leg?.congestion };
  });
  return (
    <div className="map-layer-canvas map-layer-fallback" role="img"
      aria-label={`Stylised map of ${stops.length} stops`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {segments.map((seg, i) => (
          <polyline key={seg.key} className="fallback-route" style={{ ["--i" as string]: i }}
            points={`${seg.from.x},${seg.from.y} ${seg.to.x},${seg.to.y}`} fill="none" stroke="#182544"
            strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.8 1.4" />
        ))}
        {segments.map((seg, i) => seg.congestion && (
          <polyline key={`${seg.key}-tint`} className="fallback-route-tint" style={{ ["--i" as string]: i }}
            points={`${seg.from.x},${seg.from.y} ${seg.to.x},${seg.to.y}`} fill="none"
            stroke={CONGESTION_VAR[seg.congestion]} strokeWidth="1.6" strokeOpacity="0.5"
            strokeLinecap="round" strokeLinejoin="round" />
        ))}
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
