"use client";

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Compass, RotateCcw, RotateCw } from "lucide-react";
import { loadGoogleMaps } from "@/lib/prototype/google-maps-loader";
import type { DemoRouteLeg } from "@/lib/prototype/fixtures";
import { bearing, type LatLng } from "./geo";
import { createLiveDotOverlay, type LiveDotOverlay } from "./live-dot-overlay";
import type { DemoMapStop } from "./types";

/* Minimal shapes of the Google Maps globals used here. */
type GMap = {
  fitBounds: (b: unknown, padding?: unknown) => void;
  panTo: (p: LatLng) => void;
  panBy: (x: number, y: number) => void;
  setZoom: (z: number) => void;
  getZoom: () => number | undefined;
  setTilt: (t: number) => void;
  setHeading: (h: number) => void;
  getHeading: () => number | undefined;
  setMapTypeId: (id: string) => void;
  setOptions: (o: Record<string, unknown>) => void;
  moveCamera: (c: Record<string, unknown>) => void;
  addListener: (event: string, cb: () => void) => { remove: () => void };
};
type GMaps = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
    Marker: new (opts: Record<string, unknown>) => { setMap: (m: unknown) => void };
    Polyline: new (opts: Record<string, unknown>) => {
      setMap: (m: unknown) => void;
      setOptions: (o: Record<string, unknown>) => void;
    };
    TrafficLayer: new () => { setMap: (m: unknown) => void };
    LatLngBounds: new () => { extend: (p: LatLng) => void };
    DirectionsRenderer: new (opts: Record<string, unknown>) => {
      setDirections: (r: unknown) => void;
      setMap: (m: unknown) => void;
    };
    Animation: { DROP: unknown };
    Point: new (x: number, y: number) => unknown;
    Size: new (w: number, h: number) => unknown;
    SymbolPath: { FORWARD_CLOSED_ARROW: unknown };
  };
};

// A muted, low-clutter style for the flat (2D) view so the route is the loudest thing.
const MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#f4efe4" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a7f68" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f7f1e4" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e2e8d8" }, { visibility: "on" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#f0e9d8" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e8dcc0" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "simplified" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#a9cbd6" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
];

// How far (px) to lift the followed point above the map's true centre, so it lands in the
// middle of the strip still visible between the nav card (top) and the nav bar (bottom) —
// both roughly the same height once the edge FABs/thumbnail are hidden during navigation.
const NAV_CENTER_LIFT_PX = 40;

const CONGESTION_FALLBACK: Record<NonNullable<DemoRouteLeg["congestion"]>, string> = {
  low: "#1a9750", medium: "#e0850d", high: "#e5484d",
};
/** Reads the live theme's own token for each congestion tier, so the overlay matches light/dark
 *  rather than a hardcoded palette baked into map tiles. */
function congestionColor(level: DemoRouteLeg["congestion"]): string | null {
  if (!level) return null;
  if (typeof window === "undefined") return CONGESTION_FALLBACK[level];
  const varName = level === "low" ? "--consensus" : level === "medium" ? "--flexible" : "--error";
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || CONGESTION_FALLBACK[level];
}

/** A gold star anchor marking where split branches reconverge. */
function rendezvousIcon(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="17" fill="#a9803f" stroke="#fff" stroke-width="3"/>
    <path d="M20 9l3.2 6.9 7.3.9-5.4 5.1 1.4 7.4L20 25.6l-6.5 3.7 1.4-7.4-5.4-5.1 7.3-.9z" fill="#fff"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** A navy pin with a white number, as a data-URI marker icon. */
function pinIcon(order: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
    <path d="M17 43C17 43 32 27 32 16A15 15 0 1 0 2 16C2 27 17 43 17 43Z" fill="#182544" stroke="#fff" stroke-width="2"/>
    <circle cx="17" cy="16" r="10" fill="#fff"/>
    <text x="17" y="20" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#182544">${order}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export type MapLayerHandle = { recentre: () => void };

/**
 * The Google map: a muted base style + dropped navy numbered pins + a thick route polyline in
 * 2D; in 3D it swaps to tilted satellite/aerial imagery (45° where Google has it) headed along
 * the route, Waze-style, with rotate + reset-north controls. On top: a per-leg congestion tint,
 * an optional live traffic layer, and — while navigating — a pulsing "you are here" dot that the
 * camera follows until the traveller drags the map away (see `following`/`onManualPan`).
 */
export const MapLayer = forwardRef<MapLayerHandle, {
  stops: DemoMapStop[];
  legs: DemoRouteLeg[];
  activeResult: unknown;
  /** The walked polyline per leg, in stop order — same source used for the congestion tint and
   *  the nav simulation's live dot. */
  legPaths?: LatLng[][];
  view: "2d" | "3d";
  dimmed: boolean;
  /** Where split branches rejoin, drawn as a gold star. Null on days without a split. */
  rendezvous?: { lat: number; lng: number; name: string; time: string } | null;
  /** The simulated "you are here" position while navigating. Null when not navigating. */
  liveDot?: { lat: number; lng: number; heading: number | null } | null;
  /** Whether the camera should keep panning to `liveDot` as it moves. */
  following: boolean;
  showTraffic: boolean;
  /** Fired when the traveller drags the map during navigation, so RouteScreen can drop `following`. */
  onManualPan?: () => void;
}>(function MapLayer(
  { stops, legs, activeResult, legPaths, view, dimmed, rendezvous, liveDot, following, showTraffic, onManualPan },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const rendererRef = useRef<{ setDirections: (r: unknown) => void; setMap: (m: unknown) => void } | null>(null);
  const markersRef = useRef<{ setMap: (m: unknown) => void }[]>([]);
  const congestionRef = useRef<{ setMap: (m: unknown) => void }[]>([]);
  const flowRef = useRef<{ setMap: (m: unknown) => void; setOptions: (o: Record<string, unknown>) => void } | null>(null);
  const flowOffsetRef = useRef(0);
  const trafficRef = useRef<{ setMap: (m: unknown) => void } | null>(null);
  const liveDotRef = useRef<LiveDotOverlay | null>(null);
  const dragListenerRef = useRef<{ remove: () => void } | null>(null);
  const [built, setBuilt] = useState(false);

  // Read through a ref so re-subscribing to `dragstart` doesn't churn on every render.
  const onManualPanRef = useRef(onManualPan);
  onManualPanRef.current = onManualPan;

  // Build the map once Google Maps is ready (the loader promise is cached, so this is cheap).
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(() => {
      const g = (window as unknown as { google?: GMaps }).google;
      if (cancelled || !g?.maps || !elRef.current || mapRef.current) return;
      mapRef.current = new g.maps.Map(elRef.current, {
        center: { lat: stops[0]?.lat ?? 0, lng: stops[0]?.lng ?? 0 },
        zoom: 14,
        disableDefaultUI: true,
        gestureHandling: "greedy",
        clickableIcons: false,
        styles: MAP_STYLE,
        backgroundColor: "#f7f1e4",
        rotateControl: false,
        tilt: 0,
      });
      rendererRef.current = new g.maps.DirectionsRenderer({
        map: mapRef.current,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: { strokeColor: "#182544", strokeWeight: 5, strokeOpacity: 0.92 },
      });
      liveDotRef.current = createLiveDotOverlay(mapRef.current);
      dragListenerRef.current = mapRef.current.addListener("dragstart", () => onManualPanRef.current?.());
      setBuilt(true);
    }).catch(() => { /* RouteScreen shows the fallback + the error note */ });
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      congestionRef.current.forEach((p) => p.setMap(null));
      flowRef.current?.setMap(null);
      rendererRef.current?.setMap(null);
      trafficRef.current?.setMap(null);
      liveDotRef.current?.destroy();
      dragListenerRef.current?.remove();
      mapRef.current = null;
      rendererRef.current = null;
      liveDotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame the whole day inside the strip the floating chrome doesn't cover — the left rail on
  // wide screens, the peeking bottom sheet on narrow ones.
  const frameRoute = useCallback(() => {
    const g = (window as unknown as { google?: GMaps }).google;
    const map = mapRef.current;
    if (!g?.maps || !map || stops.length === 0) return;
    const bounds = new g.maps.LatLngBounds();
    stops.forEach((s) => bounds.extend({ lat: s.lat, lng: s.lng }));
    const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
    map.fitBounds(bounds, wide
      ? { top: 112, right: 64, bottom: 64, left: 424 }
      : { top: 150, right: 44, bottom: 244, left: 44 });
  }, [stops]);

  useImperativeHandle(ref, () => ({
    recentre: () => {
      const map = mapRef.current;
      if (!map) return;
      if (liveDot) {
        const target = { lat: liveDot.lat, lng: liveDot.lng };
        const shifted = liveDotRef.current?.offset(target, 0, NAV_CENTER_LIFT_PX) ?? target;
        map.panTo(shifted);
        if ((map.getZoom() ?? 0) < 18) map.setZoom(18);
      } else {
        frameRoute();
      }
    },
  }), [liveDot, frameRoute]);

  // Re-draw pins + congestion tint + route + bounds whenever the day or the active route
  // changes (or on first build).
  useEffect(() => {
    const g = (window as unknown as { google?: GMaps }).google;
    const map = mapRef.current;
    if (!built || !g?.maps || !map || stops.length === 0) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = stops.map((s, i) => new g.maps.Marker({
      position: { lat: s.lat, lng: s.lng },
      map,
      title: `${s.order}. ${s.name}`,
      animation: g.maps.Animation.DROP,
      icon: { url: pinIcon(s.order), scaledSize: new g.maps.Size(34, 44), anchor: new g.maps.Point(17, 43) },
      zIndex: 100 + i,
    }));

    if (rendezvous) {
      markersRef.current.push(new g.maps.Marker({
        position: { lat: rendezvous.lat, lng: rendezvous.lng },
        map,
        title: `Rendezvous — ${rendezvous.name}, ${rendezvous.time}`,
        icon: { url: rendezvousIcon(), scaledSize: new g.maps.Size(40, 40), anchor: new g.maps.Point(20, 20) },
        zIndex: 400,
      }));
    }

    congestionRef.current.forEach((p) => p.setMap(null));
    congestionRef.current = [];
    if (legPaths && legPaths.length === legs.length) {
      legs.forEach((leg, i) => {
        const color = congestionColor(leg.congestion);
        const path = legPaths[i];
        if (!color || !path || path.length < 2) return;
        congestionRef.current.push(new g.maps.Polyline({
          map, path, strokeColor: color, strokeOpacity: 0.55, strokeWeight: 9, zIndex: 50, clickable: false,
        }));
      });
    }

    // A near-invisible line carrying only repeating arrow glyphs, offset-animated on an interval
    // (see the effect below) — the classic Maps technique for showing a route has a direction of
    // travel, some ambient life on the screen even before you hit Start.
    flowRef.current?.setMap(null);
    const flowPath = (legPaths ?? []).flat();
    flowRef.current = flowPath.length >= 2
      ? new g.maps.Polyline({
          map, path: flowPath, strokeOpacity: 0, zIndex: 90, clickable: false,
          icons: [{
            icon: {
              path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.8,
              fillColor: "#ffffff", fillOpacity: 0.95, strokeColor: "#182544", strokeWeight: 1.4,
            },
            offset: "0%", repeat: "64px",
          }],
        })
      : null;

    if (activeResult && rendererRef.current) rendererRef.current.setDirections(activeResult);
    // While navigating, the follow effect owns the camera — don't yank it back to the whole day.
    if (!liveDot) frameRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, legs, legPaths, activeResult, built, frameRoute, rendezvous]);

  // Animate the flow arrows drifting along the route — paused while navigating, since the live
  // dot already carries the motion cue there, and skipped under reduced-motion.
  useEffect(() => {
    if (!built || liveDot) return undefined;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = window.setInterval(() => {
      flowOffsetRef.current = (flowOffsetRef.current + 0.7) % 100;
      flowRef.current?.setOptions({
        icons: [{
          icon: {
            path: (window as unknown as { google?: GMaps }).google?.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 2.8, fillColor: "#ffffff", fillOpacity: 0.95, strokeColor: "#182544", strokeWeight: 1.4,
          },
          offset: `${flowOffsetRef.current}%`, repeat: "64px",
        }],
      });
    }, 45);
    return () => window.clearInterval(id);
  }, [built, liveDot]);

  // Live traffic, toggled by the Traffic FAB.
  useEffect(() => {
    const g = (window as unknown as { google?: GMaps }).google;
    const map = mapRef.current;
    if (!built || !g?.maps || !map) return;
    if (!trafficRef.current) trafficRef.current = new g.maps.TrafficLayer();
    trafficRef.current.setMap(showTraffic ? map : null);
  }, [showTraffic, built]);

  // Navigation mode: draw the live dot and, while following, keep the camera on it — lifted
  // clear of the nav card/bar so it reads as centred in the visible strip, not the raw div.
  // This runs on every simulated position tick (~60/s while playing), so the camera move must
  // be instant (`moveCamera`, not `panTo`): calling an *animated* pan every frame fights its own
  // still-running easing and the camera drifts rather than tracking the dot.
  useEffect(() => {
    const map = mapRef.current;
    const dot = liveDotRef.current;
    if (!built || !map) return;
    if (!liveDot) { dot?.setPosition(null); return; }
    const target = { lat: liveDot.lat, lng: liveDot.lng };
    dot?.setPosition(target);
    dot?.setHeading(liveDot.heading);
    if (following) {
      const shifted = dot?.offset(target, 0, NAV_CENTER_LIFT_PX) ?? target;
      map.moveCamera({ center: shifted, zoom: Math.max(map.getZoom() ?? 0, 18) });
    }
  }, [liveDot, following, built]);

  // 2D <-> 3D: flat styled roadmap vs. tilted aerial imagery headed along the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!built || !map || stops.length === 0) return;
    if (view === "3d") {
      const a = { lat: stops[0].lat, lng: stops[0].lng };
      const b = { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng };
      map.setMapTypeId("hybrid");
      map.setOptions({ styles: [] });
      map.panTo({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
      if ((map.getZoom() ?? 0) < 17) map.setZoom(17);
      map.setHeading(bearing(a, b));
      map.setTilt(45);
    } else {
      map.setTilt(0);
      map.setHeading(0);
      map.setMapTypeId("roadmap");
      map.setOptions({ styles: MAP_STYLE });
      frameRoute();
    }
  }, [view, built, stops, frameRoute]);

  const rotate = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setHeading(((map.getHeading() ?? 0) + delta + 360) % 360);
  }, []);
  const resetNorth = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setHeading(0);
    map.setTilt(view === "3d" ? 45 : 0);
  }, [view]);

  return (
    <div className="map-layer" data-view={view}>
      <div ref={elRef} className="map-layer-canvas" data-dimmed={dimmed ? "true" : undefined} aria-hidden="true" />
      {view === "3d" && (
        <div className="map-rotate">
          <button type="button" className="map-fab map-fab-sm" aria-label="Rotate left" onClick={() => rotate(-45)}>
            <RotateCcw aria-hidden="true" />
          </button>
          <button type="button" className="map-fab map-fab-sm" aria-label="Face north" onClick={resetNorth}>
            <Compass aria-hidden="true" />
          </button>
          <button type="button" className="map-fab map-fab-sm" aria-label="Rotate right" onClick={() => rotate(45)}>
            <RotateCw aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
});
