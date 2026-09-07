import { describe, expect, it } from "vitest";
import {
  memberEntrySchema, buildAlignmentSummary, MIN_ENTRIES_FOR_SUMMARY,
} from "@/lib/domain/member-entry";

const entry = (over: Record<string, unknown> = {}) => ({
  availability: { coverage: "full" as const, arrivalDate: null, departureDate: null },
  budgetTier: "standard" as const,
  pace: "balanced" as const,
  safetyOverrides: [] as unknown[],
  ...over,
});

describe("memberEntrySchema", () => {
  it("accepts a full-availability entry with no partial dates", () => {
    expect(memberEntrySchema.parse(entry()).availability.coverage).toBe("full");
  });
  it("defaults arrival/departure to null and safetyOverrides to []", () => {
    const parsed = memberEntrySchema.parse({
      availability: { coverage: "full" }, budgetTier: "budget", pace: "relaxed",
    });
    expect(parsed.availability).toEqual({ coverage: "full", arrivalDate: null, departureDate: null });
    expect(parsed.safetyOverrides).toEqual([]);
  });
  it("requires at least one date when coverage is partial", () => {
    expect(memberEntrySchema.safeParse(entry({
      availability: { coverage: "partial", arrivalDate: null, departureDate: null },
    })).success).toBe(false);
    expect(memberEntrySchema.parse(entry({
      availability: { coverage: "partial", arrivalDate: "2026-12-13", departureDate: null },
    })).availability.arrivalDate).toBe("2026-12-13");
  });
  it("rejects an inverted arrival/departure range", () => {
    expect(memberEntrySchema.safeParse(entry({
      availability: { coverage: "partial", arrivalDate: "2026-12-15", departureDate: "2026-12-13" },
    })).success).toBe(false);
    expect(memberEntrySchema.parse(entry({
      availability: { coverage: "partial", arrivalDate: "2026-12-13", departureDate: "2026-12-13" },
    })).availability.departureDate).toBe("2026-12-13");
  });
  it("accepts typed safety overrides and rejects an unknown flag or kind", () => {
    expect(memberEntrySchema.parse(entry({ safetyOverrides: [{ kind: "dietary", flag: "halal" }] })).safetyOverrides).toHaveLength(1);
    expect(memberEntrySchema.safeParse(entry({ safetyOverrides: [{ kind: "dietary", flag: "mystery" }] })).success).toBe(false);
    expect(memberEntrySchema.safeParse(entry({ safetyOverrides: [{ kind: "bogus", flag: "halal" }] })).success).toBe(false);
  });
  it("rejects the same safety override listed twice", () => {
    expect(() => memberEntrySchema.parse(entry({
      safetyOverrides: [{ kind: "dietary", flag: "halal" }, { kind: "dietary", flag: "halal" }],
    }))).toThrow();
    expect(memberEntrySchema.parse(entry({
      safetyOverrides: [{ kind: "dietary", flag: "halal" }, { kind: "mobility", flag: "no_stairs" }],
    })).safetyOverrides).toHaveLength(2);
  });

  it("rejects an unknown budget tier / pace and extra keys", () => {
    expect(memberEntrySchema.safeParse(entry({ budgetTier: "cheap" })).success).toBe(false);
    expect(memberEntrySchema.safeParse(entry({ pace: "sprint" })).success).toBe(false);
    expect(memberEntrySchema.safeParse({ ...entry(), note: "x" }).success).toBe(false);
  });
});

describe("buildAlignmentSummary", () => {
  it("returns null below the minimum entry count", () => {
    expect(buildAlignmentSummary([memberEntrySchema.parse(entry())])).toBeNull();
    expect(MIN_ENTRIES_FOR_SUMMARY).toBe(2);
  });
  it("aggregates budget spread, pace histogram, availability split, and safety-flag counts with no identifiers", () => {
    const entries = [
      entry({ budgetTier: "budget", pace: "relaxed" }),
      entry({ budgetTier: "premium", pace: "balanced", availability: { coverage: "partial", arrivalDate: "2026-12-13", departureDate: null } }),
      entry({ budgetTier: "standard", pace: "balanced", safetyOverrides: [{ kind: "dietary", flag: "halal" }] }),
    ].map((e) => memberEntrySchema.parse(e));
    const summary = buildAlignmentSummary(entries)!;
    expect(summary.memberCount).toBe(3);
    expect(summary.budget).toMatchObject({ min: "budget", max: "premium" });
    expect(summary.pace).toMatchObject({ relaxed: 1, balanced: 2, active: 0, intense: 0 });
    expect(summary.availability).toEqual({ full: 2, partial: 1 });
    expect(summary.safetyOverrides).toEqual([{ kind: "dietary", flag: "halal", count: 1 }]);
    expect(JSON.stringify(summary)).not.toMatch(/user|member.?id|"id"/i);
  });
});
