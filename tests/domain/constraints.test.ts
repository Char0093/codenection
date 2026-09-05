import { describe, expect, it } from "vitest";
import {
  DIETARY_FLAGS, DIETARY_FLAG_LABELS, defaultSeverity, dietaryFlagSchema,
  RELIGIOUS_ACCESS_FLAGS, RELIGIOUS_ACCESS_FLAG_LABELS, religiousAccessFlagSchema, defaultReligiousAccessSeverity,
  MOBILITY_FLAGS, MOBILITY_FLAG_LABELS, mobilityFlagSchema, defaultMobilitySeverity,
} from "@/lib/domain/constraints";

describe("dietaryFlagSchema", () => {
  it("accepts every declared flag", () => {
    for (const flag of DIETARY_FLAGS) expect(dietaryFlagSchema.parse(flag)).toBe(flag);
  });
  it("rejects free text", () => {
    expect(dietaryFlagSchema.safeParse("no peanuts please").success).toBe(false);
  });
});

describe("DIETARY_FLAG_LABELS", () => {
  it("has a display label for every flag", () => {
    for (const flag of DIETARY_FLAGS) expect(DIETARY_FLAG_LABELS[flag]).toBeTruthy();
  });
});

describe("defaultSeverity", () => {
  it("treats allergens as severe by default", () => {
    expect(defaultSeverity("no_peanut")).toBe("severe");
    expect(defaultSeverity("no_shellfish")).toBe("severe");
  });
  it("treats ordinary dietary preferences as standard", () => {
    expect(defaultSeverity("halal")).toBe("standard");
    expect(defaultSeverity("vegetarian")).toBe("standard");
    expect(defaultSeverity("no_seafood")).toBe("standard");
    expect(defaultSeverity("other")).toBe("standard");
  });
});

describe("religiousAccessFlagSchema", () => {
  it("accepts every declared flag", () => {
    for (const flag of RELIGIOUS_ACCESS_FLAGS) expect(religiousAccessFlagSchema.parse(flag)).toBe(flag);
  });
  it("rejects free text", () => {
    expect(religiousAccessFlagSchema.safeParse("must pray at noon").success).toBe(false);
  });
  it("has a display label for every flag", () => {
    for (const flag of RELIGIOUS_ACCESS_FLAGS) expect(RELIGIOUS_ACCESS_FLAG_LABELS[flag]).toBeTruthy();
  });
  it("treats every religious-access flag as standard by default", () => {
    for (const flag of RELIGIOUS_ACCESS_FLAGS) expect(defaultReligiousAccessSeverity(flag)).toBe("standard");
  });
});

describe("mobilityFlagSchema", () => {
  it("accepts every declared flag", () => {
    for (const flag of MOBILITY_FLAGS) expect(mobilityFlagSchema.parse(flag)).toBe(flag);
  });
  it("rejects free text", () => {
    expect(mobilityFlagSchema.safeParse("bad knee, avoid hills").success).toBe(false);
  });
  it("has a display label for every flag", () => {
    for (const flag of MOBILITY_FLAGS) expect(MOBILITY_FLAG_LABELS[flag]).toBeTruthy();
  });
  it("treats a hard wheelchair-access requirement as severe by default", () => {
    expect(defaultMobilitySeverity("wheelchair_accessible_required")).toBe("severe");
  });
  it("treats other mobility accommodations as standard by default", () => {
    expect(defaultMobilitySeverity("limited_walking_distance")).toBe("standard");
    expect(defaultMobilitySeverity("no_stairs")).toBe("standard");
    expect(defaultMobilitySeverity("other")).toBe("standard");
  });
});
