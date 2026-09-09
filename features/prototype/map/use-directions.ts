"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/prototype/google-maps-loader";
import { TRAVEL_MODES, type DemoMapStop, type ModeRoute, type RouteStep, type TravelMode } from "./types";

type Routes = Record<TravelMode, ModeRoute>;
const IDLE: Routes = {
  WALKING: { status: "idle" }, DRIVING: { status: "idle" },
  TRANSIT: { status: "idle" }, BICYCLING: { status: "idle" },
};

/* Minimal shape of the Google Maps globals this hook touches. */
type GMaps = {
  maps: {
    DirectionsService: new () => {
      route: (req: Record<string, unknown>, cb: (result: unknown, status: string) => void) => void;
    };
    TravelMode: Record<string, string>;
  };
};

function stripHtml(html: string): string {
  // Google puts the sub-instruction ("Destination will be on the right") in a nested <div>;
  // give it a separator so it doesn't run into the main text.
  const spaced = html.replace(/<\/?div[^>]*>/gi, " · ").replace(/<[^>]+>/g, "");
  if (typeof document === "undefined") return spaced.replace(/\s*·\s*$/,"").replace(/\s+/g, " ").trim();
  const el = document.createElement("div");
  el.innerHTML = spaced;
  return (el.textContent ?? "").replace(/\s*·\s*$/,"").replace(/\s+/g, " ").trim();
}

/* Google's DirectionsResult is not typed here; treat it structurally. */
function summarise(result: unknown): Pick<ModeRoute, "durationText" | "durationMin" | "distanceText" | "steps"> {
  const legs = (result as { routes?: { legs?: unknown[] }[] })?.routes?.[0]?.legs ?? [];
  let seconds = 0;
  let metres = 0;
  const steps: RouteStep[] = [];
  for (const legRaw of legs) {
    const leg = legRaw as {
      duration?: { value?: number };
      distance?: { value?: number };
      steps?: { instructions?: string; distance?: { text?: string }; maneuver?: string }[];
    };
    seconds += leg?.duration?.value ?? 0;
    metres += leg?.distance?.value ?? 0;
    for (const step of leg?.steps ?? []) {
      steps.push({
        instruction: stripHtml(String(step?.instructions ?? "")),
        distanceText: step?.distance?.text ?? "",
        maneuver: step?.maneuver,
      });
    }
  }
  const min = Math.round(seconds / 60);
  return {
    durationMin: min,
    durationText: min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`,
    distanceText: metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`,
    steps,
  };
}

/**
 * Loads Google Maps, then routes the given stops for every travel mode in parallel and caches
 * the result per stop set (i.e. per day). Returns the map-load status plus a per-mode record
 * the UI reads for tab labels, the summary line, and the turn-by-turn list.
 */
export function useDirections(stops: DemoMapStop[]) {
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mapError, setMapError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Routes>(IDLE);
  const cache = useRef(new Map<DemoMapStop[], Routes>());

  useEffect(() => {
    let cancelled = false;
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      if (cancelled) return;
      setMapStatus("error");
      setMapError("Google rejected the API key — check its HTTP-referrer restrictions and that Maps JavaScript API + Directions API are enabled.");
    };

    const cached = cache.current.get(stops);
    if (cached) {
      setRoutes(cached);
      setMapStatus("ready");
      return () => { cancelled = true; };
    }

    setRoutes(IDLE);
    setMapStatus("loading");
    setMapError(null);

    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        setMapStatus("ready");
        if (stops.length < 2) return;
        const g = (window as unknown as { google: GMaps }).google;
        const service = new g.maps.DirectionsService();
        const base = {
          origin: { lat: stops[0].lat, lng: stops[0].lng },
          destination: { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng },
          waypoints: stops.slice(1, -1).map((s) => ({ location: { lat: s.lat, lng: s.lng }, stopover: true })),
          optimizeWaypoints: false,
        };

        setRoutes(Object.fromEntries(TRAVEL_MODES.map((m) => [m, { status: "loading" }])) as Routes);

        TRAVEL_MODES.forEach((mode) => {
          // Google's Directions API rejects waypoints for transit; route first→last stop instead.
          const req = mode === "TRANSIT" ? { ...base, waypoints: [] } : base;
          service.route({ ...req, travelMode: g.maps.TravelMode[mode] }, (result, status) => {
            if (cancelled) return;
            setRoutes((prev) => {
              const next: Routes = {
                ...prev,
                [mode]: status === "OK"
                  ? { status: "ok", result, ...summarise(result) }
                  : { status: "error", errorCode: status },
              };
              if (TRAVEL_MODES.every((mm) => next[mm].status === "ok" || next[mm].status === "error")) {
                cache.current.set(stops, next);
              }
              return next;
            });
          });
        });
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setMapStatus("error");
        setMapError(error.message);
      });

    return () => { cancelled = true; };
  }, [stops]);

  return { mapStatus, mapError, routes };
}
