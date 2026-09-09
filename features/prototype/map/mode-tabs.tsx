"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { Bike, Car, Footprints, LoaderCircle, TramFront } from "lucide-react";
import { MODE_META, TRAVEL_MODES, type ModeRoute, type TravelMode } from "./types";

const ICON: Record<TravelMode, typeof Footprints> = {
  WALKING: Footprints, DRIVING: Car, TRANSIT: TramFront, BICYCLING: Bike,
};

/**
 * Travel-mode tabs with a sliding underline. Each tab shows that mode's live duration once its
 * Directions request resolves (a spinner until then); selecting a tab re-routes the map.
 */
export function ModeTabs({ routes, active, onChange }: {
  routes: Record<TravelMode, ModeRoute>;
  active: TravelMode;
  onChange: (mode: TravelMode) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const move = () => {
      const el = list.querySelector<HTMLElement>('[data-active="true"]');
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    move();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(move);
    ro.observe(list);
    return () => ro.disconnect();
  }, [active]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const i = TRAVEL_MODES.indexOf(active);
    const next = event.key === "ArrowLeft" ? i - 1 : i + 1;
    if (next >= 0 && next < TRAVEL_MODES.length) onChange(TRAVEL_MODES[next]);
  }

  return (
    <div className="map-modetabs" role="tablist" aria-label="Travel mode" ref={listRef} onKeyDown={onKeyDown}>
      <span className="map-modetabs-ind" style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }} aria-hidden="true" />
      {TRAVEL_MODES.map((mode) => {
        const Icon = ICON[mode];
        const route = routes[mode];
        const selected = mode === active;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={MODE_META[mode].label}
            tabIndex={selected ? 0 : -1}
            className="map-modetab"
            data-active={selected ? "true" : undefined}
            onClick={() => onChange(mode)}
          >
            <Icon size={17} aria-hidden="true" />
            <span className="map-modetab-time">
              {route.status === "loading" && <LoaderCircle size={11} className="spin" aria-hidden="true" />}
              {route.status === "ok" && route.durationText}
              {route.status === "error" && "—"}
              {route.status === "idle" && MODE_META[mode].label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
