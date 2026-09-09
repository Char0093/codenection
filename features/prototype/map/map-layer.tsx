"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Compass, RotateCcw, RotateCw } from "lucide-react";
import { loadGoogleMaps } from "@/lib/prototype/google-maps-loader";
import { bearing, type LatLng } from "./geo";
import type { DemoMapStop } from "./types";

/* Minimal shapes of the Google Maps globals used here. */
type GMap = {
  fitBounds: (b: unknown, padding?: unknown) => void;
  panTo: (p: LatLng) => void;
  setZoom: (z: number) => void;
  getZoom: () => number | undefined;
  setTilt: (t: number) => void;
  setHeading: (h: number) => void;
  getHeading: () => number | undefined;
  setMapTypeId: (id: string) => void;
  setOptions: (o: Record<string, unknown>) => void;
  moveCamera: (c: Record<string, unknown>) => void;
};
type GMaps = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
    Marker: new (opts: Record<string, unknown>) => { setMap: (m: unknown) => void };
    LatLngBounds: new () => { extend: (p: LatLng) => void };
    DirectionsRenderer: new (opts: Record<string, unknown>) => {
      setDirections: (r: unknown) => void;
      setMap: (m: unknown) => void;
    };
    Animation: { DROP: unknown };
    Point: new (x: number, y: number) => unknown;
    Size: new (w: number, h: number) => unknown;
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

/**
 * The Google map: a muted base style + dropped navy numbered pins + a thick route polyline in
 * 2D; in 3D it swaps to tilted satellite/aerial imagery (45° where Google has it) headed along
 * the route, Waze-style, with rotate + reset-north controls.
 */
export function MapLayer({ stops, activeResult, view, dimmed, rendezvous }: {
  stops: DemoMapStop[];
  activeResult: unknown;
  view: "2d" | "3d";
  dimmed: boolean;
  /** Where split branches rejoin, drawn as a gold star. Null on days without a split. */
  rendezvous?: { lat: number; lng: number; name: string; time: string } | null;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const rendererRef = useRef<{ setDirections: (r: unknown) => void; setMap: (m: unknown) => void } | null>(null);
  const markersRef = useRef<{ setMap: (m: unknown) => void }[]>([]);
  const [built, setBuilt] = useState(false);

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
      setBuilt(true);
    }).catch(() => { /* RouteScreen shows the fallback + the error note */ });
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      rendererRef.current?.setMap(null);
      mapRef.current = null;
      rendererRef.current = null;
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

  // Re-draw pins + route + bounds whenever the day or the active route changes (or on first build).
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

    if (activeResult && rendererRef.current) rendererRef.current.setDirections(activeResult);
    frameRoute();
  }, [stops, activeResult, built, frameRoute, rendezvous]);

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
}
