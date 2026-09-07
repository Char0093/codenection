// Global Travel DNA is a per-user preference baseline collected once at first login
// (spec 2026-09-06-first-login-travel-dna-chat-groups-design.md, revised 2026-09-07).
// After the safety-first pivot the survey asks for only what is safe to reuse across
// trips: one safety-vault screen of confirmed dietary / religious-access / mobility
// requirements, plus ONE optional general surprise-tolerance dial. Budget, pace, social
// role, walking caps, and destination interests are NOT global onboarding answers — they
// belong to a specific trip and are collected on create/join. The epsilon grid, strict
// objects, and vocabulary caps are load-bearing — keep them locked with tests, not prose.
import { z } from "zod";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
  DIETARY_FLAGS, RELIGIOUS_ACCESS_FLAGS, MOBILITY_FLAGS,
  type DietaryFlag, type ReligiousAccessFlag, type MobilityFlag,
} from "@/lib/domain/constraints";

/** Optional general travel baseline. Not asked during first-login onboarding after the
 * pivot; kept for a later **My Travel Preferences** editor and backfill/compat reads.
 * Keep in sync with the `traveler_travel_vibe` enum in
 * supabase/migrations/202609060001_onboarding_profile.sql. */
export const TRAVEL_VIBES = ["heritage", "food", "nature", "urban"] as const;
export type TravelVibe = (typeof TRAVEL_VIBES)[number];
export const travelVibeSchema = z.enum(TRAVEL_VIBES);
export const TRAVEL_VIBE_LABELS: Readonly<Record<TravelVibe, string>> = {
  heritage: "Heritage & history",
  food: "Food & markets",
  nature: "Nature & outdoors",
  urban: "Urban & nightlife",
};

export const SURPRISE_DIAL_DEFAULT = 3;
const EPSILON_GRID = [0, 0.075, 0.15, 0.225, 0.3] as const;
const dialSchema = z.number().int().min(1).max(5);

/** Dial 1..5 -> serendipity_epsilon grid, linear across 0.0..0.3. */
export function surpriseDialToEpsilon(dial: number): number {
  return EPSILON_GRID[dialSchema.parse(dial) - 1];
}

/** Inverse for wizard prefill. Callers MUST gate on completion first
 * (`onboardingCompletedAt == null ? SURPRISE_DIAL_DEFAULT : epsilonToSurpriseDial(...)`);
 * a completed row always carries an exact grid value. */
export function epsilonToSurpriseDial(epsilon: number): number {
  if (!Number.isFinite(epsilon)) {
    throw new RangeError(`epsilonToSurpriseDial: expected a finite number, got ${epsilon}`);
  }
  const index = EPSILON_GRID.findIndex((value) => value === epsilon);
  if (index < 0) throw new RangeError(`epsilonToSurpriseDial: ${epsilon} is not on the supported epsilon grid`);
  return index + 1;
}

function dealbreakerArray<T extends string>(flag: z.ZodType<T>, vocab: readonly T[]) {
  return z.array(flag).max(vocab.length).transform((values) => [...new Set(values)]);
}

export const dealbreakersSchema = z.strictObject({
  dietary: dealbreakerArray(dietaryFlagSchema, DIETARY_FLAGS).default([]),
  religiousAccess: dealbreakerArray(religiousAccessFlagSchema, RELIGIOUS_ACCESS_FLAGS).default([]),
  mobility: dealbreakerArray(mobilityFlagSchema, MOBILITY_FLAGS).default([]),
});

export const onboardingAnswersSchema = z.strictObject({
  dealbreakers: dealbreakersSchema,
  // 1..5, or null to skip the optional exploration dial (spec §2.2).
  surpriseDial: dialSchema.nullable().default(null),
});
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

export const submitBodySchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  answers: onboardingAnswersSchema,
});
export type SubmitBody = z.infer<typeof submitBodySchema>;

export type OnboardingSnapshot = {
  profile: {
    travelVibe: TravelVibe | null;
    serendipityEpsilon: number;
    onboardingCompletedAt: string | null;
  } | null;
  profileRevision: number;
  dealbreakers: {
    dietary: { confirmed: DietaryFlag[]; pending: DietaryFlag[] };
    religiousAccess: { confirmed: ReligiousAccessFlag[]; pending: ReligiousAccessFlag[] };
    mobility: { confirmed: MobilityFlag[]; pending: MobilityFlag[] };
  };
  needsOnboarding: boolean;
};
