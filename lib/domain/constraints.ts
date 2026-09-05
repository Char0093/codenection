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
