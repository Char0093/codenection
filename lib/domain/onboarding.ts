// Travel DNA is a global, per-user preference baseline collected once at first login
// (spec 2026-09-06-first-login-travel-dna-chat-groups-design.md). It carries no trip
// scope: these contracts describe the answers and the CAS-checked submission body only.
// The five answer groups, the epsilon grid, strict objects, vocabulary caps, and the
// Quick-mode defaults are load-bearing — keep them locked with tests, not prose.
import { z } from "zod";
import { budgetTierSchema, paceLevelSchema, type BudgetTier, type PaceLevel } from "@/lib/domain/trip";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
  DIETARY_FLAGS, RELIGIOUS_ACCESS_FLAGS, MOBILITY_FLAGS,
  type DietaryFlag, type ReligiousAccessFlag, type MobilityFlag,
} from "@/lib/domain/constraints";

/** Step 1 of Task 1.6. Keep in sync with the `traveler_travel_vibe` enum in
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

/** Step 4. Keep in sync with the `traveler_social_role` enum (migration 202609050006). */
export const SOCIAL_ROLES = ["navigator", "chronicler", "gourmand", "go_with_the_flow", "negotiator"] as const;
export type SocialRole = (typeof SOCIAL_ROLES)[number];
export const socialRoleSchema = z.enum(SOCIAL_ROLES);
export const SOCIAL_ROLE_LABELS: Readonly<Record<SocialRole, string>> = {
  navigator: "Navigator — keeps us on track",
  chronicler: "Chronicler — photos and notes",
  gourmand: "Gourmand — food comes first",
  go_with_the_flow: "Go with the flow",
  negotiator: "Negotiator — settles group calls",
};

/** Step 2 walking-distance cap. `null` means "no limit"; a number is metres for
 * `traveler_profiles.mobility_threshold_m`. */
export const WALKING_CAP_PRESETS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
  { value: null, label: "No limit" },
];

export const SURPRISE_DIAL_DEFAULT = 3;
const EPSILON_GRID = [0, 0.075, 0.15, 0.225, 0.3] as const;
const dialSchema = z.number().int().min(1).max(5);

/** Step 5. Dial 1..5 -> serendipity_epsilon grid, linear across 0.0..0.3. */
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

const walkingCapSchema = z.number().int().min(0).max(50000).nullable();

function dealbreakerArray<T extends string>(flag: z.ZodType<T>, vocab: readonly T[]) {
  return z.array(flag).max(vocab.length).transform((values) => [...new Set(values)]);
}

const dealbreakersSchema = z.strictObject({
  dietary: dealbreakerArray(dietaryFlagSchema, DIETARY_FLAGS).default([]),
  religiousAccess: dealbreakerArray(religiousAccessFlagSchema, RELIGIOUS_ACCESS_FLAGS).default([]),
  mobility: dealbreakerArray(mobilityFlagSchema, MOBILITY_FLAGS).default([]),
});

const sharedFields = {
  dealbreakers: dealbreakersSchema,
  walkingCapM: walkingCapSchema,
  budgetLean: budgetTierSchema,
};

export const onboardingAnswersSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("quick"), ...sharedFields }),
  z.strictObject({
    mode: z.literal("full"),
    ...sharedFields,
    vibe: travelVibeSchema,
    pace: paceLevelSchema,
    socialRole: socialRoleSchema,
    surpriseDial: dialSchema,
  }),
]);
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

export const submitBodySchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  answers: onboardingAnswersSchema,
});
export type SubmitBody = z.infer<typeof submitBodySchema>;

export type OnboardingSnapshot = {
  profile: {
    travelVibe: TravelVibe | null;
    budgetLean: BudgetTier | null;
    pace: PaceLevel;
    socialRole: SocialRole | null;
    serendipityEpsilon: number;
    mobilityThresholdM: number | null;
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
