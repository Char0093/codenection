import { z } from "zod";

/** Implementation_Plan.md Task 1.1: typed dietary flags, never free text. Keep in sync with the
 * `trip_constraints_dietary_flag_valid` check constraint in
 * supabase/migrations/202609050002_dietary_constraints.sql. */
export const DIETARY_FLAGS = [
  "halal", "vegetarian", "vegan", "no_seafood", "no_shellfish",
  "no_pork", "no_beef", "no_dairy", "no_gluten", "no_peanut", "other",
] as const;

export type DietaryFlag = (typeof DIETARY_FLAGS)[number];

export const dietaryFlagSchema = z.enum(DIETARY_FLAGS);

export const DIETARY_FLAG_LABELS: Readonly<Record<DietaryFlag, string>> = {
  halal: "Halal",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  no_seafood: "No seafood",
  no_shellfish: "No shellfish",
  no_pork: "No pork",
  no_beef: "No beef",
  no_dairy: "No dairy",
  no_gluten: "No gluten",
  no_peanut: "No peanut",
  other: "Other condition",
};

export const constraintSeveritySchema = z.enum(["severe", "standard"]);
export type ConstraintSeverity = z.infer<typeof constraintSeveritySchema>;

export const constraintSourceSchema = z.enum(["chat", "voice", "social", "manual"]);
export type ConstraintSource = z.infer<typeof constraintSourceSchema>;

export type DietaryConstraint = {
  id: string;
  tripMemberId: string;
  flag: DietaryFlag;
  severity: ConstraintSeverity;
  source: ConstraintSource;
  confirmedAt: string | null;
};

/** Allergens default to severe (Section VII fails closed on unknown/unverified matches for
 * severe flags); everything else is a standard preference the gate treats as a soft filter. */
const SEVERE_BY_DEFAULT = new Set<DietaryFlag>(["no_peanut", "no_shellfish"]);

export function defaultSeverity(flag: DietaryFlag): ConstraintSeverity {
  return SEVERE_BY_DEFAULT.has(flag) ? "severe" : "standard";
}

/** Section IX caps religious-access data at "an access and dress-code flag" -- deliberately not a
 * full religious-profile vocabulary. Keep in sync with `trip_constraints_religious_access_flag_valid`
 * in supabase/migrations/202609050006_traveler_profiles_poi_catalog.sql. */
export const RELIGIOUS_ACCESS_FLAGS = ["modest_dress_required", "prayer_space_needed", "no_alcohol_venues", "other"] as const;
export type ReligiousAccessFlag = (typeof RELIGIOUS_ACCESS_FLAGS)[number];
export const religiousAccessFlagSchema = z.enum(RELIGIOUS_ACCESS_FLAGS);
export const RELIGIOUS_ACCESS_FLAG_LABELS: Readonly<Record<ReligiousAccessFlag, string>> = {
  modest_dress_required: "Modest dress required",
  prayer_space_needed: "Prayer space needed",
  no_alcohol_venues: "Avoid venues serving alcohol",
  other: "Other requirement",
};

/** Section IX: "no disability categories beyond a coarse mobility threshold the traveler sets
 * themselves" -- the numeric threshold lives on traveler_profiles.mobility_threshold_m; these
 * flags are the coarse, non-diagnostic access categories a member can additionally confirm. Keep
 * in sync with `trip_constraints_mobility_flag_valid` in the same migration as above. */
export const MOBILITY_FLAGS = ["wheelchair_accessible_required", "limited_walking_distance", "no_stairs", "other"] as const;
export type MobilityFlag = (typeof MOBILITY_FLAGS)[number];
export const mobilityFlagSchema = z.enum(MOBILITY_FLAGS);
export const MOBILITY_FLAG_LABELS: Readonly<Record<MobilityFlag, string>> = {
  wheelchair_accessible_required: "Wheelchair-accessible routes required",
  limited_walking_distance: "Limited walking distance",
  no_stairs: "Avoid stairs",
  other: "Other requirement",
};

/** A hard access requirement (cannot participate at all if unmet) defaults to severe; a
 * preference-level accommodation defaults to standard, matching the dietary default's reasoning. */
const RELIGIOUS_ACCESS_SEVERE_BY_DEFAULT = new Set<ReligiousAccessFlag>([]);
const MOBILITY_SEVERE_BY_DEFAULT = new Set<MobilityFlag>(["wheelchair_accessible_required"]);

export function defaultReligiousAccessSeverity(flag: ReligiousAccessFlag): ConstraintSeverity {
  return RELIGIOUS_ACCESS_SEVERE_BY_DEFAULT.has(flag) ? "severe" : "standard";
}

export function defaultMobilitySeverity(flag: MobilityFlag): ConstraintSeverity {
  return MOBILITY_SEVERE_BY_DEFAULT.has(flag) ? "severe" : "standard";
}
