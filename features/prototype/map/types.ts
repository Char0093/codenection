import type { DemoMapStop } from "@/lib/prototype/fixtures";

export type { DemoMapStop };

export type TravelMode = "WALKING" | "DRIVING" | "TRANSIT" | "BICYCLING";

export const TRAVEL_MODES: readonly TravelMode[] = ["WALKING", "DRIVING", "TRANSIT", "BICYCLING"];

export const MODE_META: Record<TravelMode, { label: string; short: string }> = {
  WALKING: { label: "Walk", short: "walk" },
  DRIVING: { label: "Drive", short: "drive" },
  TRANSIT: { label: "Transit", short: "transit" },
  BICYCLING: { label: "Cycle", short: "cycle" },
};

export type RouteStep = {
  instruction: string;
  distanceText: string;
  maneuver?: string;
  /** Where the step begins, so navigation mode can pan the map to it. */
  lat?: number;
  lng?: number;
};

export type ModeRoute = {
  status: "idle" | "loading" | "ok" | "error";
  durationText?: string;
  durationMin?: number;
  distanceText?: string;
  steps?: RouteStep[];
  /**
   * Compass bearing you actually set off on when leaving stop i, taken from the route polyline
   * rather than the straight line to the next stop. One entry per leg. Street View's direction
   * arrow uses this: as-the-crow-flies can be tens of degrees off the walkable street.
   */
  legHeadings?: number[];
  /**
   * The full walked polyline for leg i. Street View uses it to recompute heading and remaining
   * distance from wherever the panorama currently stands, so both update as you move.
   */
  legPaths?: { lat: number; lng: number }[][];
  /** google.maps.DirectionsResult — passed straight back to the renderer. */
  result?: unknown;
  errorCode?: string;
};

export type SheetSnap = "peek" | "half" | "full";
