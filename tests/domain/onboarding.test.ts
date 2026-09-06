import { describe, expect, it } from "vitest";
import {
  surpriseDialToEpsilon, epsilonToSurpriseDial, SURPRISE_DIAL_DEFAULT,
  onboardingAnswersSchema, submitBodySchema, TRAVEL_VIBES, SOCIAL_ROLES,
} from "@/lib/domain/onboarding";

describe("surprise dial <-> epsilon", () => {
  it("maps every dial position onto the epsilon grid", () => {
    expect([1, 2, 3, 4, 5].map(surpriseDialToEpsilon)).toEqual([0, 0.075, 0.15, 0.225, 0.3]);
  });
  it("defaults to the middle position", () => {
    expect(surpriseDialToEpsilon(SURPRISE_DIAL_DEFAULT)).toBe(0.15);
  });
  it("rejects out-of-range or non-integer dials", () => {
    expect(() => surpriseDialToEpsilon(0)).toThrow();
    expect(() => surpriseDialToEpsilon(6)).toThrow();
    expect(() => surpriseDialToEpsilon(2.5)).toThrow();
  });
  it("returns a dial only for an exact stored grid value", () => {
    expect(epsilonToSurpriseDial(0)).toBe(1);
    expect(epsilonToSurpriseDial(0.15)).toBe(3);
    expect(epsilonToSurpriseDial(0.3)).toBe(5);
    expect(() => epsilonToSurpriseDial(0.2)).toThrow();
  });
  it("throws on a non-finite epsilon rather than returning a bogus dial", () => {
    expect(() => epsilonToSurpriseDial(NaN)).toThrow(/finite number/);
  });
});

describe("onboardingAnswersSchema", () => {
  const dealbreakers = { dietary: ["halal"], religiousAccess: [], mobility: [] };
  const full = {
    mode: "full", dealbreakers, walkingCapM: 2000, budgetLean: "standard",
    vibe: "food", pace: "active", socialRole: "gourmand", surpriseDial: 4,
  };

  it("accepts a well-formed full submission and dedupes dealbreakers", () => {
    const parsed = onboardingAnswersSchema.parse({
      ...full, dealbreakers: { dietary: ["halal", "halal", "vegan"], religiousAccess: [], mobility: [] },
    });
    expect(parsed.mode).toBe("full");
    if (parsed.mode === "full") expect(parsed.dealbreakers.dietary.sort()).toEqual(["halal", "vegan"]);
  });
  it("accepts a quick submission without the full-only keys", () => {
    const parsed = onboardingAnswersSchema.parse({ mode: "quick", dealbreakers, walkingCapM: null, budgetLean: "budget" });
    expect(parsed.mode).toBe("quick");
  });
  it("rejects a quick submission carrying a full-only key", () => {
    expect(() => onboardingAnswersSchema.parse({
      mode: "quick", dealbreakers, walkingCapM: null, budgetLean: "budget", surpriseDial: 3,
    })).toThrow();
  });
  it("rejects an unknown mode", () => {
    expect(() => onboardingAnswersSchema.parse({ ...full, mode: "bogus" })).toThrow();
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => onboardingAnswersSchema.parse({ ...full, extra: 1 })).toThrow();
  });
  it("rejects a full submission missing a required key", () => {
    const { vibe, ...withoutVibe } = full;
    expect(() => onboardingAnswersSchema.parse(withoutVibe)).toThrow();
  });
  it("rejects a dealbreaker array longer than its vocabulary", () => {
    expect(() => onboardingAnswersSchema.parse({
      ...full, dealbreakers: { dietary: Array(20).fill("halal"), religiousAccess: [], mobility: [] },
    })).toThrow();
  });
  it("rejects an out-of-range walking cap and an invalid enum", () => {
    expect(() => onboardingAnswersSchema.parse({ ...full, walkingCapM: -1 })).toThrow();
    expect(() => onboardingAnswersSchema.parse({ ...full, walkingCapM: 999999 })).toThrow();
    expect(() => onboardingAnswersSchema.parse({ ...full, budgetLean: "cheap" })).toThrow();
    expect(() => onboardingAnswersSchema.parse({ ...full, surpriseDial: 9 })).toThrow();
  });
});

describe("submitBodySchema", () => {
  it("requires a non-negative integer expectedRevision and strict keys", () => {
    const answers = { mode: "quick", dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, walkingCapM: null, budgetLean: "standard" };
    expect(submitBodySchema.parse({ expectedRevision: 0, answers }).expectedRevision).toBe(0);
    expect(() => submitBodySchema.parse({ expectedRevision: -1, answers })).toThrow();
    expect(() => submitBodySchema.parse({ expectedRevision: 1.5, answers })).toThrow();
    expect(() => submitBodySchema.parse({ expectedRevision: 0, answers, extra: true })).toThrow();
  });
});

it("exposes stable vocab tuples", () => {
  expect(TRAVEL_VIBES).toEqual(["heritage", "food", "nature", "urban"]);
  expect(SOCIAL_ROLES).toEqual(["navigator", "chronicler", "gourmand", "go_with_the_flow", "negotiator"]);
});
