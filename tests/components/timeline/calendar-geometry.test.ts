import { describe, expect, it } from "vitest";
import {
  MINUTES_PER_DAY,
  clampDuration,
  clampStart,
  minutesToPixels,
  minutesToTime,
  pixelsToMinutes,
  snapTo,
  timeToMinutes,
} from "@/features/timeline/calendar-geometry";

describe("timeToMinutes / minutesToTime", () => {
  it("round-trips HH:MM", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(minutesToTime(570)).toBe("09:30");
  });
  it("accepts HH:MM:SS by ignoring seconds", () => {
    expect(timeToMinutes("14:05:00")).toBe(845);
  });
  it("formats midnight and just-before-midnight", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(MINUTES_PER_DAY - 1)).toBe("23:59");
  });
  it("clamps minutesToTime into a valid day range", () => {
    expect(minutesToTime(-30)).toBe("00:00");
    expect(minutesToTime(MINUTES_PER_DAY + 30)).toBe("23:59");
  });
});

describe("snapTo", () => {
  it("snaps to the nearest step", () => {
    expect(snapTo(103, 15)).toBe(105);
    expect(snapTo(97, 15)).toBe(90);
    expect(snapTo(600, 30)).toBe(600);
  });
});

describe("clampStart / clampDuration", () => {
  it("keeps a block's start inside the day given its duration", () => {
    expect(clampStart(-10, 60)).toBe(0);
    expect(clampStart(1430, 60)).toBe(MINUTES_PER_DAY - 60);
    expect(clampStart(600, 60)).toBe(600);
  });
  it("keeps duration inside the 15-480 minute domain contract", () => {
    expect(clampDuration(5)).toBe(15);
    expect(clampDuration(600)).toBe(480);
    expect(clampDuration(90)).toBe(90);
  });
});

describe("pixel conversions", () => {
  it("is a linear, invertible mapping", () => {
    expect(minutesToPixels(60, 1.2)).toBe(72);
    expect(pixelsToMinutes(72, 1.2)).toBe(60);
  });
});
