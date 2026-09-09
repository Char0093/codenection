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

export type RouteStep = { instruction: string; distanceText: string; maneuver?: string };

export type ModeRoute = {
  status: "idle" | "loading" | "ok" | "error";
  durationText?: string;
  durationMin?: number;
  distanceText?: string;
  steps?: RouteStep[];
  /** google.maps.DirectionsResult — passed straight back to the renderer. */
  result?: unknown;
  errorCode?: string;
};

export type SheetSnap = "peek" | "half" | "full";
