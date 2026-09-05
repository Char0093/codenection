"use client";

import React, { useState } from "react";
import { ActivityCard } from "@/features/timeline/activity-card";
import { TravelBlock } from "@/features/timeline/travel-block";
import { POI_DRAG_MIME } from "@/features/timeline/poi-choice-card";
import { MOVE_SNAP_MINUTES, clampStart, minutesToPixels, pixelsToMinutes, snapTo } from "@/features/timeline/calendar-geometry";
import type { OpenInterval } from "@/lib/poi/opening-hours";
import type { DragItem } from "@/features/timeline/use-drag-commit";

/** Feasible ranges for the candidate currently being dragged from the pool, so infeasible time is
 * visibly disabled *before* the drop rather than explained after it. */
export type DropGuide = {
  candidateKey: string;
  durationMinutes: number;
  /** Empty means "no hours data" -- the whole day stays droppable, with an unverified warning. */
  openIntervals: readonly OpenInterval[];
  hoursKnown: boolean;
};

export function DayColumn({ date, items, conflictedIds, pxPerMinute, trackHeightPx, dropGuide, onMove, onResize, onUnlock, onUnschedule, onPoolDrop, announce }: {
  date: string;
  items: readonly DragItem[];
  conflictedIds: ReadonlySet<string>;
  pxPerMinute: number;
  trackHeightPx: number;
  dropGuide: DropGuide | null;
  onMove: (itemId: string, newDate: string, newStartTime: string) => void;
  onResize: (itemId: string, newStartTime: string, durationMinutes: number) => void;
  onUnlock: (itemId: string) => void;
  onUnschedule: (itemId: string) => void;
  onPoolDrop: (candidateKey: string, startMinute: number) => void;
  announce: (message: string) => void;
}) {
  const [hoverMinute, setHoverMinute] = useState<number | null>(null);

  function minuteFromEvent(event: React.DragEvent<HTMLElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = pixelsToMinutes(event.clientY - rect.top, pxPerMinute);
    const duration = dropGuide?.durationMinutes ?? 60;
    return clampStart(snapTo(raw, MOVE_SNAP_MINUTES), duration);
  }

  function fits(startMinute: number): boolean {
    if (!dropGuide) return false;
    if (!dropGuide.hoursKnown) return true; // unknown hours warn, they do not block
    const end = startMinute + dropGuide.durationMinutes;
    return dropGuide.openIntervals.some((interval) => startMinute >= interval.startMinute && end <= interval.endMinute);
  }

  return (
    <section
      className="cal-day"
      data-cal-date={date}
      aria-label={"Day " + date}
      style={{ height: trackHeightPx, backgroundSize: "100% " + 60 * pxPerMinute + "px" }}
      onDragOver={(event) => {
        if (!dropGuide) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setHoverMinute(minuteFromEvent(event));
      }}
      onDragLeave={() => setHoverMinute(null)}
      onDrop={(event) => {
        const key = event.dataTransfer.getData(POI_DRAG_MIME);
        setHoverMinute(null);
        if (!key) return;
        event.preventDefault();
        onPoolDrop(key, minuteFromEvent(event));
      }}
    >
      {/* Feasible-range shading only appears while a pool card is in flight. */}
      {dropGuide?.hoursKnown && dropGuide.openIntervals.map((interval) => (
        <div
          key={"open-" + interval.startMinute}
          className="cal-open-band"
          aria-hidden
          style={{ top: minutesToPixels(interval.startMinute, pxPerMinute), height: minutesToPixels(interval.endMinute - interval.startMinute, pxPerMinute) }}
        />
      ))}
      {dropGuide && hoverMinute !== null && (
        <div
          className="cal-drop-preview"
          data-feasible={fits(hoverMinute) ? "true" : "false"}
          aria-hidden
          style={{ top: minutesToPixels(hoverMinute, pxPerMinute), height: minutesToPixels(dropGuide.durationMinutes, pxPerMinute) }}
        />
      )}

      {items.map((item) => (
        <TravelBlock key={item.id + "-travel"} item={item} pxPerMinute={pxPerMinute} />
      ))}
      {items.map((item) => (
        <ActivityCard
          key={item.id}
          item={item}
          conflicted={conflictedIds.has(item.id)}
          pxPerMinute={pxPerMinute}
          onMove={(newDate, newStartTime) => onMove(item.id, newDate, newStartTime)}
          onResize={(newStartTime, durationMinutes) => onResize(item.id, newStartTime, durationMinutes)}
          onUnlock={() => onUnlock(item.id)}
          onUnschedule={() => onUnschedule(item.id)}
          announce={announce}
        />
      ))}
    </section>
  );
}
