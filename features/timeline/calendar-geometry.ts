/**
 * Pure geometry helpers for the calendar-style timeline (Implementation_Plan.md Task 3.4). No I/O,
 * no DOM -- kept separate from day-column.tsx so the minute/pixel math is directly unit-testable.
 */

export const MINUTES_PER_DAY = 24 * 60;
export const RESIZE_SNAP_MINUTES = 15;
export const MOVE_SNAP_MINUTES = 30;
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 480;

/** "09:30" or "09:30:00" -> 570. */
export function timeToMinutes(time: string): number {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

/** 570 -> "09:30". Matches the reorder/resize API's HH:MM contract; callers append ":00"
 * themselves only when populating local optimistic state, which mirrors the DB's HH:MM:SS rows. */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  return String(Math.floor(clamped / 60)).padStart(2, "0") + ":" + String(clamped % 60).padStart(2, "0");
}

export function snapTo(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

/** Keeps a block's start time inside [0, 1440) so a drag can never produce a start at or after
 * midnight; the caller separately rejects an end time that would cross midnight. */
export function clampStart(startMinute: number, durationMinutes: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY - durationMinutes, startMinute));
}

export function clampDuration(durationMinutes: number): number {
  return Math.max(MIN_DURATION_MINUTES, Math.min(MAX_DURATION_MINUTES, durationMinutes));
}

/** Pixel top offset for a block starting at `startMinute`, given the ruler's pixels-per-minute. */
export function minutesToPixels(minutes: number, pxPerMinute: number): number {
  return minutes * pxPerMinute;
}

export function pixelsToMinutes(pixels: number, pxPerMinute: number): number {
  return pixels / pxPerMinute;
}
