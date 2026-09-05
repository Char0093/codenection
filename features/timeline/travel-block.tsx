import React from "react";
import { Bus } from "lucide-react";
import { minutesToPixels, minutesToTime, timeToMinutes } from "@/features/timeline/calendar-geometry";
import type { DragItem } from "@/features/timeline/use-drag-commit";

/**
 * Required travel rendered as its own subordinate block immediately before the activity it leads
 * into (Task 3.4), so a visually open gap on the calendar never hides necessary transit time.
 * Read-only: travel blocks are derived from the following item's own travelMinutes, not a
 * separately draggable entity. Renders nothing when travelMinutes is 0 -- that is "no travel data
 * yet" (nothing currently populates the column), not "confirmed zero travel time"; inventing a
 * transit estimate here would be exactly the kind of fabricated number this project avoids.
 */
export function TravelBlock({ item, pxPerMinute }: { item: DragItem; pxPerMinute: number }) {
  if (item.travelMinutes <= 0) return null;
  const arrivalMinute = timeToMinutes(item.localStartTime);
  const startMinute = Math.max(0, arrivalMinute - item.travelMinutes);
  const durationMinutes = arrivalMinute - startMinute;
  if (durationMinutes <= 0) return null;

  return (
    <div
      className="cal-travel-block"
      style={{ top: minutesToPixels(startMinute, pxPerMinute), height: minutesToPixels(durationMinutes, pxPerMinute) }}
      aria-label={`Travel to ${item.title}, ${minutesToTime(startMinute)} to ${minutesToTime(arrivalMinute)}, ${durationMinutes} minutes`}
    >
      <Bus size={12} aria-hidden />
      <span className="cal-travel-label">{durationMinutes} min travel</span>
    </div>
  );
}
