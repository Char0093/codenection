"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { distanceMetres, headingAlongPath, nearestPointIndex, pathLength, pointAtDistance, type LatLng } from "./geo";
import type { RouteStep } from "./types";

export type NavSpeed = 1 | 2 | 4;

/** How long a full route takes to glide past at 1x, regardless of its real length — a 300m
 *  amble and a 7km drive both play in the same demo window so neither feels broken to watch. */
const DEMO_PLAYBACK_SECONDS = 40;
/** Metres a walker covers per minute — used only when a route has no duration to pace by. */
const FALLBACK_PACE_M_PER_MIN = 80;

export type NavSim = {
  position: LatLng | null;
  heading: number | null;
  stepIndex: number;
  progress: number;
  playing: boolean;
  arrived: boolean;
  speed: NavSpeed;
  remainingText: string;
  etaText: string;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (fraction: number) => void;
  cycleSpeed: () => void;
};

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres))} m`;
}
function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
}

/**
 * Drives simulated turn-by-turn navigation: a position gliding along the actual walked route
 * (the live Directions `legPaths`, concatenated in stop order) at a fixed demo pace — there is
 * no GPS in this prototype. What the traveller *reads* stays honest though: remaining distance
 * and ETA are paced from the route's own real duration/distance, not from the compressed
 * playback speed driving the dot on screen.
 */
export function useNavSim({ legPaths, steps, totalDurationMin, active }: {
  legPaths: LatLng[][] | undefined;
  steps: RouteStep[];
  /** The route's real-world duration for this mode, in minutes — paces the ETA. */
  totalDurationMin: number | undefined;
  /** Whether nav mode is open. Closing it stops and rewinds the animation. */
  active: boolean;
}): NavSim {
  const flat = useMemo(() => (legPaths ?? []).flat(), [legPaths]);
  const total = useMemo(() => pathLength(flat), [flat]);

  // Cumulative distance at each step's start vertex, so `traveled` maps back to a step index.
  const stepBoundaries = useMemo(() => {
    if (flat.length === 0) return [] as number[];
    const prefix: number[] = [0];
    for (let i = 1; i < flat.length; i += 1) prefix.push(prefix[i - 1] + distanceMetres(flat[i - 1], flat[i]));
    return steps.map((s) => {
      if (s.lat == null || s.lng == null) return 0;
      return prefix[nearestPointIndex(flat, { lat: s.lat, lng: s.lng })] ?? 0;
    });
  }, [flat, steps]);

  const [traveled, setTraveled] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<NavSpeed>(1);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  // A new route (day or mode changed) starts over, paused.
  useEffect(() => { setTraveled(0); setPlaying(false); }, [flat]);
  // Closing nav mode stops and rewinds, so the next "Start" begins fresh.
  useEffect(() => { if (!active) { setPlaying(false); setTraveled(0); } }, [active]);

  useEffect(() => {
    if (!playing || total <= 0) return undefined;
    lastRef.current = null;
    function tick(now: number) {
      if (lastRef.current == null) lastRef.current = now;
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      const paceMetresPerSec = total / DEMO_PLAYBACK_SECONDS;
      setTraveled((t) => {
        const next = t + dt * paceMetresPerSec * speed;
        if (next >= total) { setPlaying(false); return total; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [playing, total, speed]);

  const position = pointAtDistance(flat, traveled);
  const heading = position ? headingAlongPath(flat, position) : null;
  const progress = total > 0 ? Math.min(1, traveled / total) : 0;
  const arrived = total > 0 && traveled >= total - 0.5;

  let stepIndex = 0;
  for (let i = 0; i < stepBoundaries.length; i += 1) { if (stepBoundaries[i] <= traveled) stepIndex = i; }

  const remainingMetres = Math.max(0, total - traveled);
  const paceMetresPerMin = totalDurationMin && totalDurationMin > 0 ? total / totalDurationMin : FALLBACK_PACE_M_PER_MIN;
  const remainingMin = paceMetresPerMin > 0 ? remainingMetres / paceMetresPerMin : 0;
  const remainingText = arrived ? "Arrived" : `${formatDistance(remainingMetres)} · ${formatMinutes(remainingMin)}`;
  const etaText = arrived ? "" : `arrives ${formatClock(new Date(Date.now() + remainingMin * 60_000))}`;

  return {
    position, heading, stepIndex, progress, playing, arrived, speed, remainingText, etaText,
    play: () => { if (!arrived) setPlaying(true); },
    pause: () => setPlaying(false),
    toggle: () => setPlaying((p) => (arrived ? false : !p)),
    seek: (fraction: number) => { setTraveled(Math.min(total, Math.max(0, fraction * total))); setPlaying(false); },
    cycleSpeed: () => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1)),
  };
}
