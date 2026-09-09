"use client";

import React, { useEffect, useRef, useState } from "react";
import { Flag, LoaderCircle, Navigation2, RotateCw, X } from "lucide-react";
import { loadGoogleMaps } from "@/lib/prototype/google-maps-loader";
import type { DemoRouteLeg } from "@/lib/prototype/fixtures";
import {
  bearing, headingAlongPath, relativeBearing, remainingDistance, type LatLng,
} from "./geo";
import type { DemoMapStop } from "./types";

/* Minimal shapes of the Street View globals used here. */
type Pov = { heading: number; pitch: number };
type PanoLatLng = { lat: () => number; lng: () => number };
type Pano = {
  setPano: (id: string) => void;
  setPov: (pov: Pov) => void;
  setVisible: (v: boolean) => void;
  getPov: () => Pov;
  getPosition: () => PanoLatLng | null;
  addListener: (event: string, cb: () => void) => void;
};
type PanoData = { location?: { pano?: string } };
type GMaps = {
  maps: {
    StreetViewPanorama: new (el: HTMLElement, opts: Record<string, unknown>) => Pano;
    StreetViewService: new () => {
      getPanorama: (
        req: Record<string, unknown>,
        cb: (data: PanoData | null, status: string) => void,
      ) => void;
    };
  };
};

/** Metres a walker covers per minute — used to re-time the remaining distance as you move. */
const WALK_M_PER_MIN = 80;
/** Inside this many metres of the next stop, call it arrived. */
const ARRIVED_M = 25;

/**
 * Which way to face at stop `index` before the panorama reports a position.
 *
 * Prefers `legHeadings` — the direction the actual walking route sets off in — because the
 * straight line to the next stop can be tens of degrees off the street you have to walk down
 * (measured 28.7° at Street of Harmony), which would aim the arrow at a wall. Falls back to
 * the crow-flies bearing only when there is no route (no Maps key, or the last stop).
 */
export function povHeading(stops: DemoMapStop[], index: number, legHeadings?: number[]): number {
  const routed = legHeadings?.[index];
  if (typeof routed === "number" && Number.isFinite(routed)) return routed;
  if (stops.length < 2) return 0;
  const here = stops[index];
  const next = stops[index + 1];
  if (next) return bearing({ lat: here.lat, lng: here.lng }, { lat: next.lat, lng: next.lng });
  const prev = stops[index - 1];
  return bearing({ lat: prev.lat, lng: prev.lng }, { lat: here.lat, lng: here.lng });
}

/** Plain-language cue for how far off the travel direction you are currently looking. */
export function facingCue(delta: number): { text: string; mode: "ahead" | "turn" | "behind" } {
  const a = Math.abs(delta);
  if (a <= 25) return { text: "Straight ahead", mode: "ahead" };
  if (a >= 135) return { text: "It's behind you — turn around", mode: "behind" };
  return { text: delta > 0 ? "To your right" : "To your left", mode: "turn" };
}

/** "180 m · 2 min" — recomputed from the live remaining distance, so it counts down. */
export function formatRemaining(metres: number): string {
  const dist = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres / 10) * 10)} m`;
  const mins = Math.max(1, Math.round(metres / WALK_M_PER_MIN));
  return `${dist} · ${mins} min walk`;
}

/**
 * Ground-level Street View used as a *wayfinding* aid, not a photo viewer.
 *
 * Two things make it navigable rather than decorative: the panorama's `position_changed` is
 * tracked, so walking down the street with Google's own arrows recomputes both the heading and
 * the remaining distance from where you now stand; and `pov_changed` counter-rotates the arrow
 * so it stays locked on the route while you look around. Heading follows the route polyline
 * (`legPaths`), never the straight line to the destination.
 */
export function StreetView({ stops, legs, legHeadings, legPaths, initialIndex, onClose }: {
  stops: DemoMapStop[];
  legs: DemoRouteLeg[];
  /** Real set-off bearing per leg from the Directions polyline; see povHeading. */
  legHeadings?: number[];
  /** Full walked polyline per leg, for live heading + remaining distance. */
  legPaths?: LatLng[][];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [status, setStatus] = useState<"loading" | "ok" | "none" | "error">("loading");
  /** Live compass heading of the panorama, so the arrow can counter-rotate. */
  const [heading, setHeading] = useState<number | null>(null);
  /** Live panorama position, so distance counts down as you walk. */
  const [position, setPosition] = useState<LatLng | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const panoRef = useRef<Pano | null>(null);
  /**
   * Listeners live as long as the panorama, so they must NOT close over a per-effect
   * "cancelled" flag — once that effect re-ran, the flag latched true and the arrow silently
   * froze. Gate them on real unmount instead.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    // Must re-arm on mount, not just disarm on unmount: React StrictMode (enabled in
    // next.config.ts) runs effects mount -> unmount -> mount in development, so a
    // cleanup-only ref latches false on the second mount and every guard below bails.
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Read through a ref so newly-resolved headings don't re-run the panorama effect and
   *  yank the user's view back to the start bearing mid-look-around. */
  const headingsRef = useRef(legHeadings);
  headingsRef.current = legHeadings;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let stale = false;   // guards only this fetch, never the long-lived listeners
    const stop = stops[index];
    if (!stop) return;
    setStatus("loading");
    setPosition(null);

    loadGoogleMaps().then(() => {
      const g = (window as unknown as { google?: GMaps }).google;
      if (stale || !mountedRef.current || !g?.maps || !elRef.current) return;
      const target = povHeading(stops, index, headingsRef.current);

      new g.maps.StreetViewService().getPanorama(
        { location: { lat: stop.lat, lng: stop.lng }, radius: 60 },
        (data, svStatus) => {
          if (stale || !mountedRef.current) return;
          const panoId = data?.location?.pano;
          if (svStatus !== "OK" || !panoId) { setStatus("none"); return; }

          const readPosition = (pano: Pano) => {
            const p = pano.getPosition?.();
            if (p) setPosition({ lat: p.lat(), lng: p.lng() });
          };

          if (!panoRef.current && elRef.current) {
            const pano = new g.maps.StreetViewPanorama(elRef.current, {
              pano: panoId,
              pov: { heading: target, pitch: 0 },
              zoom: 0,
              addressControl: false,
              fullscreenControl: false,
              motionTracking: false,
              motionTrackingControl: false,
              panControl: true,
              zoomControl: true,
              linksControl: true,
            });
            // Rotating the view: keep the arrow locked on the route.
            pano.addListener("pov_changed", () => {
              if (mountedRef.current) setHeading(pano.getPov().heading);
            });
            // Walking down the street with Google's arrows: re-anchor heading and distance.
            pano.addListener("position_changed", () => {
              if (mountedRef.current) readPosition(pano);
            });
            panoRef.current = pano;
          } else if (panoRef.current) {
            panoRef.current.setPano(panoId);
            panoRef.current.setPov({ heading: target, pitch: 0 });
            panoRef.current.setVisible(true);
          }
          if (panoRef.current) readPosition(panoRef.current);
          setHeading(target);
          setStatus("ok");
        },
      );
    }).catch(() => { if (!stale && mountedRef.current) setStatus("error"); });

    return () => { stale = true; };
    // legHeadings is read via headingsRef, so a late-resolving route cannot tear down the
    // panorama and reset the user's view mid-look-around.
  }, [stops, index]);

  const stop = stops[index];
  const next = stops[index + 1];
  const path = legPaths?.[index];
  const fixtureLeg = legs.find((l) => l.fromId === stop?.id);

  // Where to point: from the live position along the route if we have both, else the set-off
  // bearing recorded at the stop.
  const liveHeading = position && path && path.length >= 2 ? headingAlongPath(path, position) : null;
  const target = liveHeading ?? (stops.length > 1 ? povHeading(stops, index, legHeadings) : 0);
  const delta = heading === null ? 0 : relativeBearing(target, heading);
  const cue = facingCue(delta);

  // How much is left: measured along the route from where the panorama actually stands.
  const remainingM = position && path && path.length >= 2
    ? remainingDistance(path, position)
    : null;
  const arrived = remainingM !== null && remainingM <= ARRIVED_M;
  const detail = remainingM !== null
    ? formatRemaining(remainingM)
    : fixtureLeg && `${fixtureLeg.minutes} min ${fixtureLeg.mode} · ${fixtureLeg.distanceKm.toFixed(1)} km`;

  return (
    <div className="map-streetview" role="dialog" aria-label="Street view">
      <div className="map-streetview-canvas" ref={elRef} aria-hidden="true" />

      {status !== "ok" && (
        <div className="map-streetview-state" role="status">
          {status === "loading" && <><LoaderCircle className="spin" aria-hidden="true" />Opening street view…</>}
          {status === "none" && <>No street view imagery within 60&nbsp;m of {stop?.name}. Try another stop.</>}
          {status === "error" && <>Street view is unavailable — check the Maps key.</>}
        </div>
      )}

      <div className="map-streetview-top">
        <div className="map-streetview-title">
          <strong>{stop?.name}</strong>
          <span>{stop?.time} · stop {stop?.order} of {stops.length}</span>
        </div>
        <button type="button" className="map-fab" aria-label="Close street view" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>

      {/* Direction guidance — the reason to open street view at all. */}
      {status === "ok" && (
        next && !arrived ? (
          <div className="sv-guide" data-mode={cue.mode}>
            <span className="sv-arrow" style={{ transform: `rotate(${delta}deg)` }} aria-hidden="true">
              {cue.mode === "behind" ? <RotateCw /> : <Navigation2 />}
            </span>
            <span className="sv-guide-text">
              <strong>{cue.text}</strong>
              <span>to {next.name}{detail ? ` · ${detail}` : ""}</span>
            </span>
          </div>
        ) : (
          <div className="sv-guide" data-mode="arrived">
            <span className="sv-arrow" aria-hidden="true"><Flag /></span>
            <span className="sv-guide-text">
              <strong>{next ? `You've reached ${next.name}` : "Last stop"}</strong>
              <span>{next ? "Tap the next number below to keep going" : `${stop?.name} · ${stop?.time}`}</span>
            </span>
          </div>
        )
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {status === "ok" && next && !arrived ? `${cue.text} to ${next.name}${detail ? `, ${detail}` : ""}` : ""}
      </p>

      <div className="map-streetview-stops" role="tablist" aria-label="Street view stop">
        {stops.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Street view at ${s.name}`}
            className="map-streetview-chip"
            data-active={i === index ? "true" : undefined}
            onClick={() => setIndex(i)}
          >
            {s.order}
          </button>
        ))}
      </div>
    </div>
  );
}
