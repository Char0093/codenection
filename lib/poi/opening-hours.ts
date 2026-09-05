/**
 * Implementation_Plan.md Task 3.4: normalize a provider (Google Places) opening-hours snapshot into
 * destination-local intervals for one date, and decide whether a proposed visit fits wholly inside
 * an open interval.
 *
 * Pure: no I/O, no clock reads, no provider calls. The provider adapter fetches and stores the
 * snapshot; this module only interprets one.
 *
 * The governing rule throughout is that **absent hours are never evidence a venue is open**. A
 * missing or unparseable snapshot yields `unknown`, which the UI must surface as a persistent
 * "Hours unverified" warning rather than silently allowing the placement to look validated.
 */

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** Google Places v1 `regularOpeningHours.periods[].open|close`. `day` is 0 = Sunday. */
export type ProviderTimePoint = { day: number; hour: number; minute: number };
export type ProviderPeriod = { open: ProviderTimePoint; close?: ProviderTimePoint | null };
export type ProviderOpeningHours = { periods?: readonly ProviderPeriod[] | null };

export type OpenInterval = { startMinute: number; endMinute: number };

export type BusinessStatus = "operational" | "closed_temporarily" | "closed_permanently";

export type OpeningStatus =
  | { kind: "open"; intervals: readonly OpenInterval[] }
  | { kind: "closed_that_day" }
  | { kind: "closed_temporarily" }
  | { kind: "closed_permanently" }
  /** No usable snapshot. Explicitly not "open" -- callers must warn, not assume. */
  | { kind: "unknown" };

function isTimePoint(value: unknown): value is ProviderTimePoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Partial<ProviderTimePoint>;
  return [point.day, point.hour, point.minute].every((part) => typeof part === "number" && Number.isFinite(part))
    && (point.day as number) >= 0 && (point.day as number) <= 6
    && (point.hour as number) >= 0 && (point.hour as number) <= 23
    && (point.minute as number) >= 0 && (point.minute as number) <= 59;
}

function weekMinute(point: ProviderTimePoint): number {
  return point.day * MINUTES_PER_DAY + point.hour * 60 + point.minute;
}

/** "09:30" or "09:30:00" -> 570. Server-side twin of the timeline's own conversion, kept here so
 * route handlers never have to import a client feature module. */
export function timeStringToMinutes(time: string): number {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

/** Day of week for a plain YYYY-MM-DD wall-clock date. Parsed as UTC so the machine's own timezone
 * cannot shift the destination-local date, matching how trip dates are handled elsewhere. */
export function weekdayForDate(isoDate: string): number {
  return new Date(isoDate + "T00:00:00Z").getUTCDay();
}

function mergeIntervals(intervals: OpenInterval[]): OpenInterval[] {
  const sorted = intervals.filter((interval) => interval.endMinute > interval.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute);
  const merged: OpenInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, interval.endMinute);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Open intervals, in minutes from local midnight, covering `isoDate`. Handles the two shapes that
 * routinely break naive implementations: **split** periods (a venue open 09:00-14:00 and again
 * 18:00-22:00 on the same day produces two intervals) and **overnight** periods (a venue open
 * 22:00 Friday to 02:00 Saturday contributes 22:00-24:00 to Friday and 00:00-02:00 to Saturday).
 * A period with no `close` is the provider's "open 24 hours" encoding.
 */
export function openIntervalsForDate(hours: ProviderOpeningHours | null | undefined, isoDate: string): OpenInterval[] {
  const periods = hours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return [];

  const weekday = weekdayForDate(isoDate);
  const dayStart = weekday * MINUTES_PER_DAY;
  const dayEnd = dayStart + MINUTES_PER_DAY;
  const intervals: OpenInterval[] = [];

  for (const period of periods) {
    if (!isTimePoint(period?.open)) continue;
    if (period.close === undefined || period.close === null) {
      // No close: open continuously. Every date is fully covered.
      return [{ startMinute: 0, endMinute: MINUTES_PER_DAY }];
    }
    if (!isTimePoint(period.close)) continue;

    const openAt = weekMinute(period.open);
    let closeAt = weekMinute(period.close);
    if (closeAt <= openAt) closeAt += MINUTES_PER_WEEK; // wraps past the end of the week

    // Compare against this date's window in the current week and in the neighbouring weeks, so an
    // overnight period that began on the previous day (or in the previous week) still contributes
    // its tail to this date.
    for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
      const start = Math.max(openAt + shift, dayStart);
      const end = Math.min(closeAt + shift, dayEnd);
      if (end > start) intervals.push({ startMinute: start - dayStart, endMinute: end - dayStart });
    }
  }

  return mergeIntervals(intervals);
}

/** Opening status for one date, folding in `businessStatus`, which outranks any hours snapshot. */
export function openingStatusForDate(
  hours: ProviderOpeningHours | null | undefined,
  businessStatus: BusinessStatus | null | undefined,
  isoDate: string,
): OpeningStatus {
  if (businessStatus === "closed_permanently") return { kind: "closed_permanently" };
  if (businessStatus === "closed_temporarily") return { kind: "closed_temporarily" };
  if (!hours?.periods || hours.periods.length === 0) return { kind: "unknown" };
  const intervals = openIntervalsForDate(hours, isoDate);
  if (intervals.length === 0) return { kind: "closed_that_day" };
  return { kind: "open", intervals };
}

/** True only when the whole visit fits inside a single open interval. A visit that starts while
 * open and runs past closing is not a valid drop. */
export function fitsWithinOpenInterval(
  intervals: readonly OpenInterval[],
  startMinute: number,
  durationMinutes: number,
): boolean {
  const endMinute = startMinute + durationMinutes;
  return intervals.some((interval) => startMinute >= interval.startMinute && endMinute <= interval.endMinute);
}

export type DropFeasibility =
  | { droppable: true; warning?: string }
  | { droppable: false; reason: string };

/**
 * Whether a visit may be placed at `startMinute` on `isoDate`. Unknown hours do not block an
 * authorized placement, but they attach a warning that must stay visible on the block and in
 * proposal review -- the plan is explicit that this is a warning, never a silent open claim.
 */
export function evaluateDrop(
  status: OpeningStatus,
  startMinute: number,
  durationMinutes: number,
): DropFeasibility {
  if (status.kind === "closed_permanently") return { droppable: false, reason: "This place is permanently closed." };
  if (status.kind === "closed_temporarily") return { droppable: false, reason: "This place is temporarily closed." };
  if (status.kind === "closed_that_day") return { droppable: false, reason: "This place is closed on the selected day." };
  if (status.kind === "unknown") return { droppable: true, warning: "Hours unverified — confirm before visiting" };
  if (!fitsWithinOpenInterval(status.intervals, startMinute, durationMinutes)) {
    return { droppable: false, reason: "The visit does not fit inside the opening hours." };
  }
  return { droppable: true };
}

/** Provider snapshots have a permitted retention window; past it the snapshot is treated as absent
 * (unknown) rather than quietly reused, per docs/features/provider-adapters.md. */
export function isSnapshotUsable(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now.getTime();
}
