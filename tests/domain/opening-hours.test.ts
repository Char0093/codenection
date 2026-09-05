import { describe, expect, it } from "vitest";
import {
  evaluateDrop,
  fitsWithinOpenInterval,
  isSnapshotUsable,
  openIntervalsForDate,
  openingStatusForDate,
  weekdayForDate,
  type ProviderOpeningHours,
} from "@/lib/poi/opening-hours";

// 2026-10-01 is a Thursday (day 4); 2026-10-02 Friday (5); 2026-10-03 Saturday (6).
const THURSDAY = "2026-10-01";
const FRIDAY = "2026-10-02";
const SATURDAY = "2026-10-03";

function hours(periods: ProviderOpeningHours["periods"]): ProviderOpeningHours {
  return { periods };
}

describe("weekdayForDate", () => {
  it("reads the weekday from the wall-clock date, not the machine timezone", () => {
    expect(weekdayForDate(THURSDAY)).toBe(4);
    expect(weekdayForDate(SATURDAY)).toBe(6);
  });
});

describe("openIntervalsForDate", () => {
  it("returns a single interval for an ordinary same-day period", () => {
    const result = openIntervalsForDate(hours([
      { open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 17, minute: 30 } },
    ]), THURSDAY);
    expect(result).toEqual([{ startMinute: 540, endMinute: 1050 }]);
  });

  it("returns both intervals for a split day", () => {
    const result = openIntervalsForDate(hours([
      { open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 14, minute: 0 } },
      { open: { day: 4, hour: 18, minute: 0 }, close: { day: 4, hour: 22, minute: 0 } },
    ]), THURSDAY);
    expect(result).toEqual([
      { startMinute: 540, endMinute: 840 },
      { startMinute: 1080, endMinute: 1320 },
    ]);
  });

  it("splits an overnight period across both dates it touches", () => {
    const overnight = hours([{ open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }]);
    expect(openIntervalsForDate(overnight, FRIDAY)).toEqual([{ startMinute: 1320, endMinute: 1440 }]);
    expect(openIntervalsForDate(overnight, SATURDAY)).toEqual([{ startMinute: 0, endMinute: 120 }]);
  });

  it("carries a week-wrapping overnight period into the following Sunday", () => {
    // Saturday 23:00 to Sunday 01:00 wraps past the end of the provider's week.
    const wrapping = hours([{ open: { day: 6, hour: 23, minute: 0 }, close: { day: 0, hour: 1, minute: 0 } }]);
    expect(openIntervalsForDate(wrapping, SATURDAY)).toEqual([{ startMinute: 1380, endMinute: 1440 }]);
    expect(openIntervalsForDate(wrapping, "2026-10-04")).toEqual([{ startMinute: 0, endMinute: 60 }]);
  });

  it("treats a period with no close as open around the clock", () => {
    expect(openIntervalsForDate(hours([{ open: { day: 0, hour: 0, minute: 0 } }]), THURSDAY))
      .toEqual([{ startMinute: 0, endMinute: 1440 }]);
  });

  it("merges overlapping periods rather than reporting them twice", () => {
    const result = openIntervalsForDate(hours([
      { open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 13, minute: 0 } },
      { open: { day: 4, hour: 12, minute: 0 }, close: { day: 4, hour: 17, minute: 0 } },
    ]), THURSDAY);
    expect(result).toEqual([{ startMinute: 540, endMinute: 1020 }]);
  });

  it("returns nothing for a day the venue never opens, and for an absent snapshot", () => {
    expect(openIntervalsForDate(hours([{ open: { day: 0, hour: 9, minute: 0 }, close: { day: 0, hour: 17, minute: 0 } }]), THURSDAY)).toEqual([]);
    expect(openIntervalsForDate(null, THURSDAY)).toEqual([]);
    expect(openIntervalsForDate({ periods: [] }, THURSDAY)).toEqual([]);
  });

  it("ignores malformed periods instead of trusting them", () => {
    const result = openIntervalsForDate({ periods: [
      { open: { day: 99, hour: 9, minute: 0 }, close: { day: 4, hour: 17, minute: 0 } },
      { open: { day: 4, hour: 10, minute: 0 }, close: { day: 4, hour: 12, minute: 0 } },
    ] } as ProviderOpeningHours, THURSDAY);
    expect(result).toEqual([{ startMinute: 600, endMinute: 720 }]);
  });
});

describe("openingStatusForDate", () => {
  const open9to5 = hours([{ open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 17, minute: 0 } }]);

  it("lets businessStatus outrank any hours snapshot", () => {
    expect(openingStatusForDate(open9to5, "closed_permanently", THURSDAY)).toEqual({ kind: "closed_permanently" });
    expect(openingStatusForDate(open9to5, "closed_temporarily", THURSDAY)).toEqual({ kind: "closed_temporarily" });
  });

  it("reports unknown -- never open -- when there is no snapshot", () => {
    expect(openingStatusForDate(null, "operational", THURSDAY)).toEqual({ kind: "unknown" });
    expect(openingStatusForDate(null, null, THURSDAY)).toEqual({ kind: "unknown" });
  });

  it("distinguishes closed-that-day from open", () => {
    expect(openingStatusForDate(open9to5, "operational", FRIDAY)).toEqual({ kind: "closed_that_day" });
    expect(openingStatusForDate(open9to5, "operational", THURSDAY)).toMatchObject({ kind: "open" });
  });
});

describe("fitsWithinOpenInterval", () => {
  const intervals = [{ startMinute: 540, endMinute: 720 }, { startMinute: 1080, endMinute: 1320 }];

  it("accepts a visit wholly inside one interval", () => {
    expect(fitsWithinOpenInterval(intervals, 600, 60)).toBe(true);
    expect(fitsWithinOpenInterval(intervals, 540, 180)).toBe(true);
  });

  it("rejects a visit that starts before opening or runs past closing", () => {
    expect(fitsWithinOpenInterval(intervals, 500, 60)).toBe(false);
    expect(fitsWithinOpenInterval(intervals, 690, 60)).toBe(false);
  });

  it("rejects a visit that spans the gap between two intervals", () => {
    expect(fitsWithinOpenInterval(intervals, 700, 400)).toBe(false);
  });
});

describe("evaluateDrop", () => {
  it("refuses closed venues with a specific reason", () => {
    expect(evaluateDrop({ kind: "closed_permanently" }, 600, 60)).toMatchObject({ droppable: false });
    expect(evaluateDrop({ kind: "closed_temporarily" }, 600, 60)).toMatchObject({ droppable: false });
    expect(evaluateDrop({ kind: "closed_that_day" }, 600, 60)).toMatchObject({ droppable: false });
  });

  it("allows an unknown-hours placement but attaches a persistent warning", () => {
    const result = evaluateDrop({ kind: "unknown" }, 600, 60);
    expect(result).toMatchObject({ droppable: true });
    expect((result as { warning: string }).warning).toMatch(/unverified/i);
  });

  it("refuses a visit that does not fit inside the open interval", () => {
    const status = { kind: "open" as const, intervals: [{ startMinute: 540, endMinute: 720 }] };
    expect(evaluateDrop(status, 700, 60)).toMatchObject({ droppable: false });
    expect(evaluateDrop(status, 600, 60)).toEqual({ droppable: true });
  });
});

describe("isSnapshotUsable", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("treats an expired or missing snapshot as unusable rather than reusing it", () => {
    expect(isSnapshotUsable(null, now)).toBe(false);
    expect(isSnapshotUsable("2026-10-01T11:59:00Z", now)).toBe(false);
    expect(isSnapshotUsable("not-a-date", now)).toBe(false);
  });
  it("accepts a snapshot still inside its permitted window", () => {
    expect(isSnapshotUsable("2026-10-01T13:00:00Z", now)).toBe(true);
  });
});
