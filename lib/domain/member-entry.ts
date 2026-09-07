// Per-trip member entry (spec 2026-09-06-first-login-travel-dna-chat-groups-design.md
// §2.4 / §3.3, revised 2026-09-07). Before joining a trip a member supplies their own
// availability, budget tier, pace, and any per-trip override of their saved safety
// requirements. The app then shows only an AGGREGATE, NON-ATTRIBUTABLE alignment summary —
// never a member's raw budget, health detail, or veto attribution (§6).
import { z } from "zod";
import {
  budgetTierSchema, paceLevelSchema, calendarDateSchema, budgetTiers, paceLevels,
  type BudgetTier, type PaceLevel,
} from "@/lib/domain/trip";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
} from "@/lib/domain/constraints";

export const AVAILABILITY_COVERAGE = ["full", "partial"] as const;
export const MIN_ENTRIES_FOR_SUMMARY = 2;

const flagRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dietary"), flag: dietaryFlagSchema }),
  z.strictObject({ kind: z.literal("religious_access"), flag: religiousAccessFlagSchema }),
  z.strictObject({ kind: z.literal("mobility"), flag: mobilityFlagSchema }),
]);
export type FlagRef = z.infer<typeof flagRefSchema>;

export const memberEntrySchema = z.strictObject({
  availability: z.strictObject({
    coverage: z.enum(AVAILABILITY_COVERAGE),
    arrivalDate: calendarDateSchema.nullable().default(null),
    departureDate: calendarDateSchema.nullable().default(null),
  }).superRefine((availability, ctx) => {
    if (availability.coverage === "partial" && availability.arrivalDate == null && availability.departureDate == null) {
      ctx.addIssue({ code: "custom", path: ["arrivalDate"], message: "Partial availability needs an arrival or departure date." });
    }
    if (availability.arrivalDate != null && availability.departureDate != null
        && availability.departureDate < availability.arrivalDate) {
      ctx.addIssue({ code: "custom", path: ["departureDate"], message: "Departure must be on or after arrival." });
    }
  }),
  budgetTier: budgetTierSchema,
  pace: paceLevelSchema,
  safetyOverrides: z.array(flagRefSchema).max(24).default([]),
});
export type MemberEntry = z.infer<typeof memberEntrySchema>;

export type AlignmentSummary = {
  memberCount: number;
  budget: { min: BudgetTier; max: BudgetTier };
  pace: Record<PaceLevel, number>;
  availability: { full: number; partial: number };
  safetyOverrides: Array<{ kind: FlagRef["kind"]; flag: string; count: number }>;
};

/** Loose runtime guard for the summary shape (used at API boundaries). The precise
 * aggregation contract is `buildAlignmentSummary` + its tests. */
export const alignmentSummarySchema = z.strictObject({
  memberCount: z.number().int().min(MIN_ENTRIES_FOR_SUMMARY),
  budget: z.strictObject({ min: budgetTierSchema, max: budgetTierSchema }),
  pace: z.record(paceLevelSchema, z.number().int().min(0)),
  availability: z.strictObject({ full: z.number().int().min(0), partial: z.number().int().min(0) }),
  safetyOverrides: z.array(z.strictObject({
    kind: z.enum(["dietary", "religious_access", "mobility"]),
    flag: z.string().min(1),
    count: z.number().int().min(1),
  })),
});

const BUDGET_ORDER: readonly BudgetTier[] = budgetTiers.map((tier) => tier.value);
const PACE_ORDER: readonly PaceLevel[] = paceLevels.map((pace) => pace.value);

/** Aggregate, non-attributable summary of the members who have entered a trip. Returns
 * `null` below the de-anonymization floor (`MIN_ENTRIES_FOR_SUMMARY`). Never emits an id. */
export function buildAlignmentSummary(entries: MemberEntry[]): AlignmentSummary | null {
  if (entries.length < MIN_ENTRIES_FOR_SUMMARY) return null;

  const budgets = [...entries]
    .map((entry) => entry.budgetTier)
    .sort((a, b) => BUDGET_ORDER.indexOf(a) - BUDGET_ORDER.indexOf(b));

  const pace = Object.fromEntries(PACE_ORDER.map((level) => [level, 0])) as Record<PaceLevel, number>;
  for (const entry of entries) pace[entry.pace] += 1;

  const availability = { full: 0, partial: 0 };
  for (const entry of entries) availability[entry.availability.coverage] += 1;

  const counts = new Map<string, { kind: FlagRef["kind"]; flag: string; count: number }>();
  for (const entry of entries) {
    for (const override of entry.safetyOverrides) {
      const key = `${override.kind}:${override.flag}`;
      counts.set(key, { kind: override.kind, flag: override.flag, count: (counts.get(key)?.count ?? 0) + 1 });
    }
  }

  return {
    memberCount: entries.length,
    budget: { min: budgets[0], max: budgets[budgets.length - 1] },
    pace,
    availability,
    safetyOverrides: [...counts.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.flag.localeCompare(b.flag),
    ),
  };
}
