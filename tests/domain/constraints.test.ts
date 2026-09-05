import { describe, expect, it } from "vitest";
import { DIETARY_FLAGS, DIETARY_FLAG_LABELS, defaultSeverity, dietaryFlagSchema } from "@/lib/domain/constraints";

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
