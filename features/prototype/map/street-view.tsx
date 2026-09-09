"use client";

import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { loadGoogleMaps } from "@/lib/prototype/google-maps-loader";
import { bearing } from "./geo";
import type { DemoMapStop } from "./types";

/* Minimal shapes of the Street View globals used here. */
type Pano = {
  setPano: (id: string) => void;
  setPov: (pov: { heading: number; pitch: number }) => void;
  setVisible: (v: boolean) => void;
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

/** Look the way you'd walk: toward the next stop, or back along the last leg at the end. */
export function povHeading(stops: DemoMapStop[], index: number): number {
  if (stops.length < 2) return 0;
  const here = stops[index];
  const next = stops[index + 1];
  if (next) return bearing({ lat: here.lat, lng: here.lng }, { lat: next.lat, lng: next.lng });
  const prev = stops[index - 1];
  return bearing({ lat: prev.lat, lng: prev.lng }, { lat: here.lat, lng: here.lng });
}

/**
 * Ground-level Street View for the day's stops. Opens over the map, keeps the map's own state
 * (2D/3D, day, mode) untouched underneath, and lets you hop between stops from the chip row.
 * Stops Google has not driven fall back to a clear "no imagery" state rather than a blank box.
 */
export function StreetView({ stops, initialIndex, onClose }: {
  stops: DemoMapStop[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [status, setStatus] = useState<"loading" | "ok" | "none" | "error">("loading");
  const elRef = useRef<HTMLDivElement | null>(null);
  const panoRef = useRef<Pano | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const stop = stops[index];
    if (!stop) return;
    setStatus("loading");

    loadGoogleMaps().then(() => {
      const g = (window as unknown as { google?: GMaps }).google;
      if (cancelled || !g?.maps || !elRef.current) return;
      const heading = povHeading(stops, index);

      new g.maps.StreetViewService().getPanorama(
        { location: { lat: stop.lat, lng: stop.lng }, radius: 60 },
        (data, svStatus) => {
          if (cancelled) return;
          const panoId = data?.location?.pano;
          if (svStatus !== "OK" || !panoId) { setStatus("none"); return; }
          if (!panoRef.current && elRef.current) {
            panoRef.current = new g.maps.StreetViewPanorama(elRef.current, {
              pano: panoId,
              pov: { heading, pitch: 0 },
              zoom: 0,
              addressControl: false,
              fullscreenControl: false,
              motionTracking: false,
              motionTrackingControl: false,
              panControl: true,
              zoomControl: true,
              linksControl: true,
            });
          } else if (panoRef.current) {
            panoRef.current.setPano(panoId);
            panoRef.current.setPov({ heading, pitch: 0 });
            panoRef.current.setVisible(true);
          }
          setStatus("ok");
        },
      );
    }).catch(() => { if (!cancelled) setStatus("error"); });

    return () => { cancelled = true; };
  }, [stops, index]);

  const stop = stops[index];

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
