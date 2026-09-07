// FROZEN pre-pivot (2026-09-06) trip-scoped Travel DNA contract.
//
// The delivered trip-scoped onboarding flow — `app/actions/onboarding.ts`,
// `app/api/trips/[tripId]/onboarding/route.ts`, the five-screen
// `components/onboarding-wizard.tsx`, and the `submit_onboarding(uuid, bigint, jsonb)` RPC
// in 202609060001 — still speaks this shape through the compatibility window (spec §4.5).
// New global first-login onboarding uses the safety-first `lib/domain/onboarding.ts`.
// This module is retired together with the trip-scoped flow in Slice 6.
import { z } from "zod";
import { budgetTierSchema, paceLevelSchema, type BudgetTier, type PaceLevel } from "@/lib/domain/trip";
import type { DietaryFlag, ReligiousAccessFlag, MobilityFlag } from "@/lib/domain/constraints";
import { travelVibeSchema, dealbreakersSchema, type TravelVibe } from "@/lib/domain/onboarding";

/** Keep in sync with the `traveler_social_role` enum (migration 202609050006). */
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

/** Walking-distance cap. `null` means "no limit"; a number is metres for
 * `traveler_profiles.mobility_threshold_m`. */
export const WALKING_CAP_PRESETS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: 500, label: "500 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
  { value: null, label: "No limit" },
];

const dialSchema = z.number().int().min(1).max(5);
const walkingCapSchema = z.number().int().min(0).max(50000).nullable();

const sharedFields = {
  dealbreakers: dealbreakersSchema,
  walkingCapM: walkingCapSchema,
  budgetLean: budgetTierSchema,
};

export const legacyOnboardingAnswersSchema = z.discriminatedUnion("mode", [
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
export type LegacyOnboardingAnswers = z.infer<typeof legacyOnboardingAnswersSchema>;

export const legacySubmitBodySchema = z.strictObject({
  expectedRevision: z.number().int().min(0),
  answers: legacyOnboardingAnswersSchema,
});
export type LegacySubmitBody = z.infer<typeof legacySubmitBodySchema>;

export type LegacyOnboardingSnapshot = {
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
