"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SheetSnap } from "./types";

const SNAPS: SheetSnap[] = ["peek", "half", "full"];
const PEEK_PX = 208;

function vh(fraction: number): number {
  return (typeof window === "undefined" ? 800 : window.innerHeight) * fraction;
}

/** Offset (px from fully-open) for each snap point, given the sheet's own height. */
function offsets(sheetPx: number): Record<SheetSnap, number> {
  return { full: 0, half: Math.max(0, sheetPx - vh(0.52)), peek: Math.max(0, sheetPx - PEEK_PX) };
}

/**
 * A Google-Maps-style bottom sheet with three snap points (peek / half / full). Drag the grab
 * handle, or click/Enter it to cycle. Springs to the nearest snap on release. On wide screens
 * the CSS re-docks it as a left rail and the drag maths still resolve harmlessly.
 */
export function RouteSheet({ snap, onSnapChange, children }: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [dragY, setDragY] = useState<number | null>(null); // live px offset while dragging
  const drag = useRef<{ startY: number; startOffset: number; moved: number } | null>(null);

  const currentOffset = useCallback((): number => {
    const h = sheetRef.current?.offsetHeight ?? vh(0.92);
    return offsets(h)[snap];
  }, [snap]);

  const settle = useCallback((rawOffset: number) => {
    const h = sheetRef.current?.offsetHeight ?? vh(0.92);
    const map = offsets(h);
    const nearest = SNAPS.reduce((best, s) =>
      Math.abs(map[s] - rawOffset) < Math.abs(map[best] - rawOffset) ? s : best, SNAPS[0]);
    setDragY(null);
    onSnapChange(nearest);
  }, [onSnapChange]);

  function onPointerDown(event: React.PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = { startY: event.clientY, startOffset: currentOffset(), moved: 0 };
    setDragY(currentOffset());
  }
  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const delta = event.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.abs(delta));
    const h = sheetRef.current?.offsetHeight ?? vh(0.92);
    setDragY(Math.min(Math.max(0, d.startOffset + delta), offsets(h).peek + 40));
  }
  function onPointerUp(event: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (!d) return;
    if (d.moved < 6) {
      // treat as a tap: cycle to the next snap
      const i = SNAPS.indexOf(snap);
      setDragY(null);
      onSnapChange(SNAPS[(i + 1) % SNAPS.length]);
    } else {
      settle(dragY ?? d.startOffset);
    }
  }

  // Keep the transform correct across viewport resizes.
  useEffect(() => {
    const onResize = () => setDragY(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const translate = dragY ?? currentOffset();

  return (
    <div
      ref={sheetRef}
      className="map-sheet"
      data-snap={snap}
      data-dragging={dragY !== null ? "true" : undefined}
      style={{ transform: `translateY(${translate}px)` }}
      role="dialog"
      aria-label="Route details"
    >
      <button
        type="button"
        className="map-sheet-handle"
        aria-label={`Route details, ${snap}. Activate to expand.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="map-sheet-grip" aria-hidden="true" />
      </button>
      <div className="map-sheet-body">{children}</div>
    </div>
  );
}
