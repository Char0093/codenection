"use client";

import React, { useMemo } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { DayColumn } from "@/features/timeline/day-column";
import { useDragCommit, type DragItem } from "@/features/timeline/use-drag-commit";

function tripDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

/** Same-day overlap, purely for the visual warning -- the server is the actual source of truth. */
function detectDayConflicts(items: readonly DragItem[]): Set<string> {
  const conflicted = new Set<string>();
  const sorted = items.slice().sort((left, right) => left.localStartTime.localeCompare(right.localStartTime));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].localStartTime < sorted[i].localEndTime) {
        conflicted.add(sorted[i].id);
        conflicted.add(sorted[j].id);
      }
    }
  }
  return conflicted;
}

export function TimelinePane({ tripId, startDate, endDate, revision }: {
  tripId: string;
  startDate: string;
  endDate: string;
  revision: number;
}) {
  const { items, loading, loadError, commitDrag } = useDragCommit(tripId, revision);
  const dates = useMemo(() => tripDates(startDate, endDate), [startDate, endDate]);
  const byDate = useMemo(() => {
    const map = new Map<string, DragItem[]>();
    for (const date of dates) map.set(date, []);
    for (const item of items) map.set(item.localDate, [...(map.get(item.localDate) ?? []), item]);
    return map;
  }, [items, dates]);
  const conflictsByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [date, dayItems] of byDate) map.set(date, detectDayConflicts(dayItems));
    return map;
  }, [byDate]);

  if (loading) return <p className="inline-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading itinerary...</p>;
  if (loadError) return <p className="error-notice" role="alert"><AlertCircle aria-hidden="true" /><span>{loadError}</span></p>;

  return <div className="timeline-pane" aria-label="Active itinerary, drag to reschedule">
    {dates.map((date) => (
      <DayColumn key={date} date={date} items={byDate.get(date) ?? []} conflictedIds={conflictsByDate.get(date) ?? new Set()}
        onDrop={(itemId, newDate, newStartTime) => void commitDrag(itemId, newDate, newStartTime)} />
    ))}
  </div>;
}
