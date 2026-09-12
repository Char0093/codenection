"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  Bookmark, Box, Crosshair, Map as MapIcon, Navigation, PersonStanding, Plus, Share2, TrafficCone,
} from "lucide-react";
import Link from "next/link";
import { DEMO_MAP_STOPS, DEMO_ROUTE_LEGS, DEMO_TRIP_DATES, DEMO_TRIP_ID } from "@/lib/prototype/fixtures";
import { DEMO_SPLIT } from "@/lib/prototype/demo-features";
import { MAPS_KEY } from "@/lib/prototype/google-maps-loader";
import { MapLayer, type MapLayerHandle } from "./map-layer";
import { FallbackMap } from "./fallback-map";
import { RouteCard } from "./route-card";
import { RouteSheet } from "./route-sheet";
import { ModeTabs } from "./mode-tabs";
import { StopList } from "./stop-list";
import { StreetView } from "./street-view";
import { StreetThumb } from "./street-thumb";
import { NavMode } from "./nav-mode";
import { useDirections } from "./use-directions";
import { useNavSim } from "./use-nav-sim";
import { MODE_META, type ModeRoute, type SheetSnap, type TravelMode } from "./types";

/** Rough per-mode figures from the fixture legs, for when there is no Google key. */
function fixtureRoutes(date: string): Record<TravelMode, ModeRoute> {
  const legs = DEMO_ROUTE_LEGS[date] ?? [];
  const walkMin = legs.reduce((s, l) => s + l.minutes, 0);
  const km = legs.reduce((s, l) => s + l.distanceKm, 0);
  const mk = (min: number): ModeRoute => ({
    status: "ok",
    durationMin: Math.max(1, Math.round(min)),
    durationText: `${Math.max(1, Math.round(min))} min`,
    distanceText: `${km.toFixed(1)} km`,
  });
  return {
    WALKING: mk(walkMin),
    DRIVING: mk(walkMin / 3.6),
    TRANSIT: mk(walkMin * 0.75),
    BICYCLING: mk(walkMin / 2.8),
  };
}

export function RouteScreen() {
  const [selectedDate, setSelectedDate] = useState(DEMO_TRIP_DATES[0]);
  const [mode, setMode] = useState<TravelMode>("WALKING");
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [showTraffic, setShowTraffic] = useState(false);
  // Index of the stop whose Street View is open; null = the map is showing.
  const [streetStop, setStreetStop] = useState<number | null>(null);
  // Whether turn-by-turn nav mode is open.
  const [navigating, setNavigating] = useState(false);
  // Whether the camera is following the simulated live position, or the traveller panned away.
  const [following, setFollowing] = useState(true);
  const mapLayerRef = useRef<MapLayerHandle | null>(null);

  const stops = DEMO_MAP_STOPS[selectedDate] ?? [];
  const legs = DEMO_ROUTE_LEGS[selectedDate] ?? [];
  const { mapStatus, mapError, routes } = useDirections(stops);

  const liveMap = Boolean(MAPS_KEY) && mapStatus !== "error";
  const displayRoutes = useMemo<Record<TravelMode, ModeRoute>>(
    () => (Boolean(MAPS_KEY) && mapStatus !== "error" ? routes : fixtureRoutes(selectedDate)),
    [routes, mapStatus, selectedDate],
  );
  const active = displayRoutes[mode];
  const steps = active?.steps ?? [];
  const canNavigate = liveMap && steps.length > 0 && (active?.legPaths?.length ?? 0) > 0;

  const sim = useNavSim({
    legPaths: active?.legPaths, steps, totalDurationMin: active?.durationMin, active: navigating,
  });
  const liveDot = navigating && sim.position
    ? { lat: sim.position.lat, lng: sim.position.lng, heading: sim.heading }
    : null;

  function recentre() {
    if (navigating) { setFollowing(true); return; }
    mapLayerRef.current?.recentre();
  }

  function startNavigation() {
    if (!canNavigate) return;
    setSnap("peek");   // get the sheet out of the way of the map
    setFollowing(true);
    setNavigating(true);
    sim.play();
  }

  function exitNavigation() {
    setNavigating(false);
    setSnap("half");
    setFollowing(true);
  }

  return (
    <div className="map-screen" data-snap={snap} data-navigating={navigating ? "true" : undefined}>
      <div className="map-screen-map">
        {liveMap
          ? <MapLayer ref={mapLayerRef} stops={stops} legs={legs} activeResult={active?.result}
              legPaths={active?.legPaths} view={view} dimmed={snap === "full"}
              rendezvous={selectedDate === DEMO_SPLIT.date ? DEMO_SPLIT.rendezvous : null}
              liveDot={liveDot} following={following} showTraffic={showTraffic}
              onManualPan={() => setFollowing(false)} />
          : <FallbackMap stops={stops} legs={legs} />}
        {!liveMap && mapError && (
          <p className="map-screen-note" role="status">{mapError} — showing the stylised map instead.</p>
        )}
        {liveMap && !navigating && <StreetThumb stops={stops} onOpen={() => setStreetStop(0)} />}
      </div>

      {!navigating && (
        <RouteCard stops={stops} dates={DEMO_TRIP_DATES} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      )}

      {!navigating && (
        <div className="map-screen-controls">
          {liveMap && (
            <button
              type="button"
              className="map-fab map-fab-pill"
              data-on={view === "3d" ? "true" : undefined}
              aria-pressed={view === "3d"}
              aria-label={view === "3d" ? "Switch to 2D map" : "Switch to 3D map"}
              onClick={() => setView((v) => (v === "3d" ? "2d" : "3d"))}
            >
              {view === "3d" ? <MapIcon aria-hidden="true" /> : <Box aria-hidden="true" />}
              <span>{view === "3d" ? "2D" : "3D"}</span>
            </button>
          )}
          {liveMap && (
            <button type="button" className="map-fab map-fab-pill" aria-label="Open street view"
              onClick={() => setStreetStop(0)}>
              <PersonStanding aria-hidden="true" />
              <span>Street view</span>
            </button>
          )}
          {liveMap && (
            <button type="button" className="map-fab map-fab-pill" data-on={showTraffic ? "true" : undefined}
              aria-pressed={showTraffic} aria-label="Toggle live traffic"
              onClick={() => setShowTraffic((v) => !v)}>
              <TrafficCone aria-hidden="true" />
              <span>Traffic</span>
            </button>
          )}
          <button type="button" className="map-fab map-fab-pill map-fab-hero" aria-label="Recentre on the route"
            onClick={recentre}>
            <Crosshair aria-hidden="true" />
            <span>Recentre</span>
          </button>
        </div>
      )}

      {navigating && !following && (
        <button type="button" className="nav-recentre" onClick={recentre}>
          <Crosshair aria-hidden="true" size={15} />Re-centre
        </button>
      )}

      {streetStop !== null && (
        <StreetView stops={stops} legs={legs} legHeadings={active?.legHeadings}
          legPaths={active?.legPaths}
          initialIndex={streetStop} onClose={() => setStreetStop(null)} />
      )}

      {navigating && (
        <NavMode
          steps={steps}
          sim={sim}
          destination={stops[stops.length - 1]?.name ?? "your destination"}
          onExit={exitNavigation}
        />
      )}

      <RouteSheet snap={snap} onSnapChange={setSnap}>
        <ModeTabs routes={displayRoutes} active={mode} onChange={setMode} />

        <div className="map-summary">
          <p className="map-summary-time">
            {active?.durationText ?? "—"}
            {active?.distanceText && <span className="map-summary-dist"> ({active.distanceText})</span>}
          </p>
          <p className="map-summary-sub">
            Best {MODE_META[mode].short} route for {selectedDate} · arrives {stops[stops.length - 1]?.time ?? "—"}
          </p>
          <div className="map-chips">
            <span className="map-chip">{stops.length} stops</span>
            <span className="map-chip map-chip-safe">shellfish-safe</span>
            <span className="map-chip">budget</span>
          </div>
        </div>

        <StopList stops={stops} legs={legs} activeRoute={active}
          onLookAround={liveMap ? setStreetStop : undefined} />

        <div className="map-cta">
          <button
            type="button"
            className="primary-button"
            disabled={!canNavigate}
            title={canNavigate ? undefined : "Turn-by-turn needs the live Google route"}
            onClick={startNavigation}
          >
            <Navigation aria-hidden="true" />Start
          </button>
          {/* The choice pool lives on the Timeline, so send them there rather than faking it. */}
          <Link href={`/trips/${DEMO_TRIP_ID}/timeline`} className="secondary-button">
            <Plus aria-hidden="true" />Add stop
          </Link>
          <button type="button" className="icon-button" aria-label="Share (demo only)" tabIndex={-1}>
            <Share2 aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Save (demo only)" tabIndex={-1}>
            <Bookmark aria-hidden="true" />
          </button>
        </div>

        <p className="demo-hint">
          Demo — the map and route come from Google Directions{liveMap ? "" : " (stylised fallback; add a Maps key to go live)"};
          stop times and the meta chips are sample data. Nothing here is saved.
        </p>
      </RouteSheet>
    </div>
  );
}
