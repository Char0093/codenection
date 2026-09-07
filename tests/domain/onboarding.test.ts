import { describe, expect, it } from "vitest";
import {
  surpriseDialToEpsilon, epsilonToSurpriseDial, SURPRISE_DIAL_DEFAULT,
  onboardingAnswersSchema, submitBodySchema, TRAVEL_VIBES,
} from "@/lib/domain/onboarding";

describe("surprise dial <-> epsilon", () => {
  it("maps every dial position onto the epsilon grid", () => {
    expect([1, 2, 3, 4, 5].map(surpriseDialToEpsilon)).toEqual([0, 0.075, 0.15, 0.225, 0.3]);
  });
  it("defaults to the middle position", () => {
    expect(surpriseDialToEpsilon(SURPRISE_DIAL_DEFAULT)).toBe(0.15);
  });
  it("rejects out-of-range / non-integer dials and off-grid epsilons", () => {
    expect(() => surpriseDialToEpsilon(0)).toThrow();
    expect(() => surpriseDialToEpsilon(6)).toThrow();
    expect(() => surpriseDialToEpsilon(2.5)).toThrow();
    expect(() => epsilonToSurpriseDial(0.2)).toThrow();
    expect(() => epsilonToSurpriseDial(NaN)).toThrow(/finite number/);
  });
  it("returns a dial only for an exact stored grid value", () => {
    expect(epsilonToSurpriseDial(0)).toBe(1);
    expect(epsilonToSurpriseDial(0.15)).toBe(3);
    expect(epsilonToSurpriseDial(0.3)).toBe(5);
  });
});

describe("onboardingAnswersSchema", () => {
  const base = { dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] } };

  it("accepts a safety-only submission with no dial (skip)", () => {
    const parsed = onboardingAnswersSchema.parse({ ...base, surpriseDial: null });
    expect(parsed.surpriseDial).toBeNull();
    expect(parsed.dealbreakers.dietary).toEqual(["halal"]);
  });
  it("defaults a missing surpriseDial to null", () => {
    expect(onboardingAnswersSchema.parse(base).surpriseDial).toBeNull();
  });
  it("accepts an integer dial 1..5 and dedupes + caps dealbreakers", () => {
    const parsed = onboardingAnswersSchema.parse({
      dealbreakers: { dietary: ["halal", "halal", "vegan"], religiousAccess: [], mobility: [] },
      surpriseDial: 4,
    });
    expect(parsed.surpriseDial).toBe(4);
    expect(parsed.dealbreakers.dietary.sort()).toEqual(["halal", "vegan"]);
  });
  it("rejects a dial outside 1..5, a non-integer dial, an unknown flag, extra keys, and a non-object dealbreakers", () => {
    expect(onboardingAnswersSchema.safeParse({ ...base, surpriseDial: 0 }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...base, surpriseDial: 6 }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...base, surpriseDial: 2.5 }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({
      dealbreakers: { dietary: ["mystery"], religiousAccess: [], mobility: [] }, surpriseDial: null,
    }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ ...base, surpriseDial: null, mode: "full" }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ dealbreakers: [], surpriseDial: null }).success).toBe(false);
  });
  it("rejects a dealbreaker array longer than its vocabulary", () => {
    expect(onboardingAnswersSchema.safeParse({
      dealbreakers: { dietary: Array(20).fill("halal"), religiousAccess: [], mobility: [] }, surpriseDial: null,
    }).success).toBe(false);
  });
  it("defaults each dealbreaker list to [] when the object is empty", () => {
    const parsed = onboardingAnswersSchema.parse({ dealbreakers: {}, surpriseDial: null });
    expect(parsed.dealbreakers).toEqual({ dietary: [], religiousAccess: [], mobility: [] });
  });
});

describe("submitBodySchema", () => {
  const answers = { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null };
  it("requires a non-negative integer expectedRevision and strict keys", () => {
    expect(submitBodySchema.parse({ expectedRevision: 0, answers }).expectedRevision).toBe(0);
    expect(submitBodySchema.safeParse({ expectedRevision: -1, answers }).success).toBe(false);
    expect(submitBodySchema.safeParse({ expectedRevision: 1.5, answers }).success).toBe(false);
    expect(submitBodySchema.safeParse({ expectedRevision: 0, answers, extra: true }).success).toBe(false);
  });
});

it("still exports the four travel vibes for later profile editing", () => {
  expect([...TRAVEL_VIBES]).toEqual(["heritage", "food", "nature", "urban"]);
});
