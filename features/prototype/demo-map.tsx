"use client";

import React from "react";
import { RouteScreen } from "@/features/prototype/map/route-screen";

/**
 * Feature: live map + travel-time routing. A Google-Maps-style screen — full-bleed map, a
 * floating route card, edge controls and a draggable bottom sheet with travel-mode tabs,
 * the day's stops and turn-by-turn steps. With NEXT_PUBLIC_GOOGLE_MAPS_KEY set the map and
 * routes are real (Directions API); without it, a stylised fallback keeps the same chrome.
 * See features/prototype/map/ and docs/prototype-backend-logic.md.
 */
export function DemoMap() {
  return <RouteScreen />;
}
