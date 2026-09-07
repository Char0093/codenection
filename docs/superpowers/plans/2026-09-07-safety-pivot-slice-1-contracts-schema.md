# Slice 1 — contracts + schema + backfill (safety-first pivot)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development. TDD: RED → GREEN → commit. Steps are `- [ ]`.
> Umbrella: `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`.
> Spec: `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md`.

**Goal:** Reshape the global Travel DNA domain contract to a safety-only baseline, drop the
four now-unused `user_travel_profiles` columns, rework `submit_user_onboarding`, replace
`create_trip_group(text)` with the organizer trip frame, add `trip_member_entries` + its
aggregate summary function, and rework the backfill — all test-covered. **No `app/` or
`lib/repositories/` code changes** (routes/actions/wizard/pages are Slices 2–4). Only tests
consume these contracts today, so this slice ships independently.

**Consumes:** existing enums `public.budget_tier`, `public.pace_level`,
`public.traveler_social_role`, `public.traveler_travel_vibe`,
`public.trip_constraint_kind`, `public.trip_constraint_severity`,
`public.trip_constraint_source`; helper `public._onboarding_check_flags(jsonb, text[])`
(from `202609060001`, granted to `authenticated`); trigger
`public.trips_create_owner_membership` (owner membership on `trips` insert);
`public.ordinary_trim(text)`; the authenticated `trips` insert grant from `202609030004`
(`name, owner_user_id, destination_name, start_date, end_date, budget_tier, pace, notes`).

**Produces (names later slices rely on):**
- `lib/domain/onboarding.ts`: `onboardingAnswersSchema` → `{ dealbreakers, surpriseDial: number|null }`;
  `submitBodySchema` → `{ expectedRevision: number, answers: OnboardingAnswers }`;
  `OnboardingSnapshot.profile` → `{ travelVibe: TravelVibe|null, serendipityEpsilon: number, onboardingCompletedAt: string|null } | null`;
  unchanged exports `surpriseDialToEpsilon`, `epsilonToSurpriseDial`, `EPSILON_GRID`,
  `SURPRISE_DIAL_DEFAULT`, `TRAVEL_VIBES`, `travelVibeSchema`, `TRAVEL_VIBE_LABELS`,
  `dealbreakersSchema`.
- `lib/domain/trip.ts`: `TRIP_MODES`, `tripModeSchema`, `TRIP_MODE_LABELS`;
  `createTripFrameSchema` → `CreateTripFrameInput`
  (`{ name, destinationName, tripMode, proposedBudgetTier: BudgetTier|null, splitAllowed: boolean }`
  plus **either** `{ startDate, endDate }` **or** `{ plannedDurationDays: number }`);
  `frameEnablesChat(fields)` predicate. `isTripReady` unchanged.
- `lib/domain/member-entry.ts`: `AVAILABILITY_COVERAGE`, `memberEntrySchema` → `MemberEntry`
  (`{ availability: { coverage, arrivalDate: string|null, departureDate: string|null }, budgetTier, pace, safetyOverrides: FlagRef[] }`);
  `FlagRef` = `{ kind: "dietary"|"religious_access"|"mobility", flag: string }`;
  `alignmentSummarySchema` → `AlignmentSummary`; `buildAlignmentSummary(entries): AlignmentSummary | null`
  (`null` below `MIN_ENTRIES_FOR_SUMMARY = 2`); never includes a user id.
- `lib/domain/trip-preview.ts`: `tripPreviewSchema` → `TripPreview`
  (`{ organizerName, destinationName: string|null, startDate: string|null, endDate: string|null, plannedDurationDays: number|null, memberCount: number, proposedBudgetTier: BudgetTier|null, pace: PaceLevel|null }`).
- Migration `202609060004_travel_dna_safety_baseline.sql`: `user_travel_profiles` without
  `budget_lean/pace/social_role/mobility_threshold_m`; `submit_user_onboarding(bigint, jsonb)`
  with the safety-only body; `create_trip_group(text, text, date, date, int, text, text, boolean)`
  returns `uuid`; `public.trip_mode` enum; `trips.trip_mode`, `trips.proposed_budget_tier`,
  `trips.split_allowed`, `trips.planned_duration_days`; `trip_member_entries` table;
  `submit_member_entry(uuid, jsonb)` returns `void`; `trip_alignment_summary(uuid)` returns
  `jsonb` (`security definer`).
- Migration `202609060005_travel_dna_backfill_v2.sql`: `_run_travel_dna_backfill()` and
  `travel_dna_backfill_report` reworked for the reduced columns.

---

## Task 1 — Safety-only onboarding domain contract

**Files:**
- Modify: `lib/domain/onboarding.ts`
- Test: `tests/domain/onboarding.test.ts` (rewrite)

**Interfaces:**
- Produces: `onboardingAnswersSchema`, `submitBodySchema`, `OnboardingAnswers`,
  `OnboardingSnapshot` (see header). Keeps `surpriseDialToEpsilon`, `epsilonToSurpriseDial`,
  `EPSILON_GRID`, `SURPRISE_DIAL_DEFAULT`, `TRAVEL_VIBES`/`travelVibeSchema`/`TRAVEL_VIBE_LABELS`,
  `dealbreakersSchema`.
- Removes: `SOCIAL_ROLES`, `socialRoleSchema`, `SOCIAL_ROLE_LABELS`, `WALKING_CAP_PRESETS`,
  `walkingCapSchema`, the `mode` discriminated union, `sharedFields.budgetLean` /
  `sharedFields.walkingCapM`.

- [ ] **Step 1: Rewrite the failing test.** Replace `tests/domain/onboarding.test.ts` so it
      imports only `surpriseDialToEpsilon, epsilonToSurpriseDial, SURPRISE_DIAL_DEFAULT,
      EPSILON_GRID, onboardingAnswersSchema, submitBodySchema, TRAVEL_VIBES` and covers:

```ts
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
  it("defaults each dealbreaker list to [] when the object is empty", () => {
    const parsed = onboardingAnswersSchema.parse({ dealbreakers: {}, surpriseDial: null });
    expect(parsed.dealbreakers).toEqual({ dietary: [], religiousAccess: [], mobility: [] });
  });
});

describe("submitBodySchema", () => {
  it("requires a non-negative integer expectedRevision and valid answers", () => {
    const ok = submitBodySchema.parse({
      expectedRevision: 0,
      answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null },
    });
    expect(ok.expectedRevision).toBe(0);
    expect(submitBodySchema.safeParse({ expectedRevision: -1, answers: ok.answers }).success).toBe(false);
    expect(submitBodySchema.safeParse({ expectedRevision: 1.5, answers: ok.answers }).success).toBe(false);
  });
});

it("still exports the four travel vibes for later profile editing", () => {
  expect([...TRAVEL_VIBES]).toEqual(["heritage", "food", "nature", "urban"]);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm test -- tests/domain/onboarding.test.ts`):
      import errors for removed symbols / `mode` still required.

- [ ] **Step 3: Edit `lib/domain/onboarding.ts`.** Keep the epsilon helpers, `EPSILON_GRID`,
      `SURPRISE_DIAL_DEFAULT`, `dialSchema`, `TRAVEL_VIBES`/schema/labels, and
      `dealbreakerArray` / `dealbreakersSchema` exactly as they are. Delete `SOCIAL_ROLES` +
      schema + labels, `WALKING_CAP_PRESETS`, `walkingCapSchema`, and the `budgetTierSchema`/
      `paceLevelSchema` imports if now unused. Replace the union + snapshot:

```ts
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
```
      Update the file's top comment: the survey is now one safety-vault screen + an optional
      dial; no budget/pace/social-role/walking-cap answers.

- [ ] **Step 4: Run it — expect PASS.** Then `npm run typecheck` — expect failures only in
      `app/actions/onboarding.ts`, `components/onboarding-wizard.tsx`,
      `tests/**` that reference removed fields. **Do not fix those here** — Slice 2 owns the
      wizard/action; the trip-scoped action still compiles against `submitBodySchema` (it
      passes `answers` straight through) but its `getMyOnboarding` mapping of
      `budget_lean/pace/social_role` now over-populates a narrower type. Add a
      `// TODO(slice-2): drop trip-scoped mapping of removed profile fields` and cast the
      trip-scoped snapshot assembly to `OnboardingSnapshot["profile"]` with only the three
      surviving keys so typecheck passes. Keep the change minimal — no behavior edit.

- [ ] **Step 5: Commit** — `feat(onboarding): safety-only global Travel DNA contract`
      (`lib/domain/onboarding.ts`, `tests/domain/onboarding.test.ts`, the minimal
      `app/actions/onboarding.ts` type patch).

---

## Task 2 — Organizer trip-frame + member-entry + preview contracts

**Files:**
- Modify: `lib/domain/trip.ts`, `lib/domain/chat-home.ts`
- Create: `lib/domain/member-entry.ts`, `lib/domain/trip-preview.ts`
- Test: `tests/domain/trip-frame.test.ts` (new), `tests/domain/member-entry.test.ts` (new)

**Interfaces:** see header "Produces". `createTripGroupSchema` (old, name-only) is removed;
grep first — only `lib/domain/trip.ts` and its (currently absent) tests reference it.

- [ ] **Step 1: Write `tests/domain/trip-frame.test.ts` (RED).**

```ts
import { describe, expect, it } from "vitest";
import { createTripFrameSchema, TRIP_MODES, frameEnablesChat } from "@/lib/domain/trip";

const base = { name: "Melaka crew", destinationName: "Melaka", tripMode: "balanced" as const,
  proposedBudgetTier: null, splitAllowed: false };

describe("createTripFrameSchema", () => {
  it("accepts an explicit date pair within 14 days", () => {
    const p = createTripFrameSchema.parse({ ...base, startDate: "2026-12-12", endDate: "2026-12-14" });
    expect(p).toMatchObject({ destinationName: "Melaka", tripMode: "balanced" });
  });
  it("accepts a duration-only frame (1..14 days) with no dates", () => {
    expect(createTripFrameSchema.parse({ ...base, plannedDurationDays: 5 }).plannedDurationDays).toBe(5);
  });
  it("rejects a frame with neither dates nor duration", () => {
    expect(createTripFrameSchema.safeParse(base).success).toBe(false);
  });
  it("rejects an inverted / >14-day date range, duration outside 1..14, an unknown mode, a blank destination, and sensitive text", () => {
    expect(createTripFrameSchema.safeParse({ ...base, startDate: "2026-12-14", endDate: "2026-12-12" }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, startDate: "2026-12-01", endDate: "2026-12-30" }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, plannedDurationDays: 0 }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, plannedDurationDays: 15 }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, tripMode: "party", plannedDurationDays: 3 }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, destinationName: "  ", plannedDurationDays: 3 }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, destinationName: "trip for my wheelchair user", plannedDurationDays: 3 }).success).toBe(false);
  });
  it("accepts an optional proposed budget tier and split flag", () => {
    const p = createTripFrameSchema.parse({ ...base, plannedDurationDays: 4, proposedBudgetTier: "premium", splitAllowed: true });
    expect(p).toMatchObject({ proposedBudgetTier: "premium", splitAllowed: true });
  });
});

describe("frameEnablesChat", () => {
  it("is true once destination + mode + (dates or duration) exist", () => {
    expect(frameEnablesChat({ destinationName: "Melaka", tripMode: "balanced", startDate: null, endDate: null, plannedDurationDays: 3 })).toBe(true);
    expect(frameEnablesChat({ destinationName: "Melaka", tripMode: "balanced", startDate: "2026-12-12", endDate: "2026-12-14", plannedDurationDays: null })).toBe(true);
  });
  it("is false with a missing destination, mode, or time frame", () => {
    expect(frameEnablesChat({ destinationName: null, tripMode: "balanced", startDate: "2026-12-12", endDate: "2026-12-14", plannedDurationDays: null })).toBe(false);
    expect(frameEnablesChat({ destinationName: "Melaka", tripMode: null, startDate: "2026-12-12", endDate: "2026-12-14", plannedDurationDays: null })).toBe(false);
    expect(frameEnablesChat({ destinationName: "Melaka", tripMode: "balanced", startDate: null, endDate: null, plannedDurationDays: null })).toBe(false);
  });
});

it("exposes exactly the four trip modes", () => {
  expect([...TRIP_MODES]).toEqual(["relaxed", "balanced", "adventurous", "mixed"]);
});
```

- [ ] **Step 2: Write `tests/domain/member-entry.test.ts` (RED).**

```ts
import { describe, expect, it } from "vitest";
import { memberEntrySchema, buildAlignmentSummary, MIN_ENTRIES_FOR_SUMMARY } from "@/lib/domain/member-entry";

const entry = (over = {}) => ({
  availability: { coverage: "full" as const, arrivalDate: null, departureDate: null },
  budgetTier: "standard" as const, pace: "balanced" as const, safetyOverrides: [], ...over,
});

describe("memberEntrySchema", () => {
  it("accepts a full-availability entry with no partial dates", () => {
    expect(memberEntrySchema.parse(entry()).availability.coverage).toBe("full");
  });
  it("requires at least one date when coverage is partial", () => {
    expect(memberEntrySchema.safeParse(entry({ availability: { coverage: "partial", arrivalDate: null, departureDate: null } })).success).toBe(false);
    expect(memberEntrySchema.parse(entry({ availability: { coverage: "partial", arrivalDate: "2026-12-13", departureDate: null } })).availability.arrivalDate).toBe("2026-12-13");
  });
  it("accepts typed safety overrides and rejects an unknown flag/kind", () => {
    expect(memberEntrySchema.parse(entry({ safetyOverrides: [{ kind: "dietary", flag: "halal" }] })).safetyOverrides).toHaveLength(1);
    expect(memberEntrySchema.safeParse(entry({ safetyOverrides: [{ kind: "dietary", flag: "mystery" }] })).success).toBe(false);
    expect(memberEntrySchema.safeParse(entry({ safetyOverrides: [{ kind: "bogus", flag: "halal" }] })).success).toBe(false);
  });
  it("rejects an unknown budget tier / pace and extra keys", () => {
    expect(memberEntrySchema.safeParse(entry({ budgetTier: "cheap" })).success).toBe(false);
    expect(memberEntrySchema.safeParse(entry({ pace: "sprint" })).success).toBe(false);
    expect(memberEntrySchema.safeParse({ ...entry(), note: "x" }).success).toBe(false);
  });
});

describe("buildAlignmentSummary", () => {
  it("returns null below the minimum entry count", () => {
    expect(buildAlignmentSummary([entry()])).toBeNull();
    expect(MIN_ENTRIES_FOR_SUMMARY).toBe(2);
  });
  it("aggregates budget spread, pace histogram, availability split, and safety-flag counts with no identifiers", () => {
    const summary = buildAlignmentSummary([
      entry({ budgetTier: "budget", pace: "relaxed" }),
      entry({ budgetTier: "premium", pace: "balanced", availability: { coverage: "partial", arrivalDate: "2026-12-13", departureDate: null } }),
      entry({ budgetTier: "standard", pace: "balanced", safetyOverrides: [{ kind: "dietary", flag: "halal" }] }),
    ])!;
    expect(summary.memberCount).toBe(3);
    expect(summary.budget).toMatchObject({ min: "budget", max: "premium" });
    expect(summary.pace).toMatchObject({ relaxed: 1, balanced: 2, active: 0, intense: 0 });
    expect(summary.availability).toEqual({ full: 2, partial: 1 });
    expect(summary.safetyOverrides).toEqual([{ kind: "dietary", flag: "halal", count: 1 }]);
    expect(JSON.stringify(summary)).not.toMatch(/user|member.?id|"id"/i);
  });
});
```

- [ ] **Step 3: Run both — expect FAIL** (modules/exports missing).

- [ ] **Step 4: Implement `lib/domain/trip.ts` additions.** After the existing trip-group
      block, replace `createTripGroupSchema`/`CreateTripGroupInput` with:

```ts
export const TRIP_MODES = ["relaxed", "balanced", "adventurous", "mixed"] as const;
export type TripMode = (typeof TRIP_MODES)[number];
export const tripModeSchema = z.enum(TRIP_MODES);
export const TRIP_MODE_LABELS: Readonly<Record<TripMode, string>> = {
  relaxed: "Relaxed", balanced: "Balanced", adventurous: "Adventurous", mixed: "A mix",
};

const durationDaysSchema = z.number().int().min(1).max(14);

export const createTripFrameSchema = z.strictObject({
  name: tripGroupNameSchema,
  destinationName: z.string().trim().min(1, "Destination is required.").max(120)
    .refine(hasNoLikelySensitiveData, ordinaryTextMessage),
  tripMode: tripModeSchema,
  startDate: calendarDateSchema.optional(),
  endDate: calendarDateSchema.optional(),
  plannedDurationDays: durationDaysSchema.optional(),
  proposedBudgetTier: budgetTierSchema.nullable().default(null),
  splitAllowed: z.boolean().default(false),
}).superRefine((input, ctx) => {
  const hasPair = input.startDate != null && input.endDate != null;
  const hasDuration = input.plannedDurationDays != null;
  if (!hasPair && !hasDuration) {
    ctx.addIssue({ code: "custom", path: ["startDate"], message: "Provide trip dates or a duration." });
  }
  if (hasPair) {
    const err = validateTripDates(input.startDate!, input.endDate!);
    if (err) ctx.addIssue({ code: "custom", path: ["endDate"], message: err });
  }
  if ((input.startDate == null) !== (input.endDate == null)) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Provide both a start and an end date, or neither." });
  }
});
export type CreateTripFrameInput = z.infer<typeof createTripFrameSchema>;

export function frameEnablesChat(fields: {
  destinationName: string | null;
  tripMode: TripMode | string | null;
  startDate: string | null;
  endDate: string | null;
  plannedDurationDays: number | null;
}): boolean {
  if (!fields.destinationName || !fields.destinationName.trim()) return false;
  if (!fields.tripMode || !tripModeSchema.safeParse(fields.tripMode).success) return false;
  const hasPair = !!fields.startDate && !!fields.endDate;
  return hasPair || (fields.plannedDurationDays != null && fields.plannedDurationDays >= 1);
}
```
      Keep `tripStatusSchema`, `isTripReady`, and the top-of-block comment (adjust the
      comment: a frame now also needs destination + mode + dates-or-duration to enable chat;
      `ready` (generation) still requires a concrete valid date pair).

- [ ] **Step 5: Create `lib/domain/member-entry.ts`.**

```ts
import { z } from "zod";
import { budgetTierSchema, paceLevelSchema, budgetTiers, paceLevels,
  type BudgetTier, type PaceLevel } from "@/lib/domain/trip";
import { calendarDateSchema } from "@/lib/domain/trip";
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
  }).superRefine((a, ctx) => {
    if (a.coverage === "partial" && a.arrivalDate == null && a.departureDate == null) {
      ctx.addIssue({ code: "custom", path: ["arrivalDate"], message: "Partial availability needs an arrival or departure date." });
    }
  }),
  budgetTier: budgetTierSchema,
  pace: paceLevelSchema,
  safetyOverrides: z.array(flagRefSchema).max(24).default([]),
});
export type MemberEntry = z.infer<typeof memberEntrySchema>;

export const alignmentSummarySchema = z.strictObject({
  memberCount: z.number().int().min(MIN_ENTRIES_FOR_SUMMARY),
  budget: z.strictObject({ min: budgetTierSchema, max: budgetTierSchema }),
  pace: z.record(paceLevelSchema, z.number().int().min(0)),
  availability: z.strictObject({ full: z.number().int().min(0), partial: z.number().int().min(0) }),
  safetyOverrides: z.array(z.strictObject({
    kind: flagRefSchema.options[0].shape.kind.or(z.literal("religious_access")).or(z.literal("mobility")),
    flag: z.string(), count: z.number().int().min(1),
  })),
});
export type AlignmentSummary = z.infer<typeof alignmentSummarySchema>;

const BUDGET_ORDER: BudgetTier[] = budgetTiers.map((t) => t.value);
const PACE_ORDER: PaceLevel[] = paceLevels.map((p) => p.value);

/** Aggregate, non-attributable (spec §2.4 / §3.3 / §6). Returns null below the de-anon floor. */
export function buildAlignmentSummary(entries: MemberEntry[]): AlignmentSummary | null {
  if (entries.length < MIN_ENTRIES_FOR_SUMMARY) return null;
  const budgets = entries.map((e) => e.budgetTier).sort((a, b) => BUDGET_ORDER.indexOf(a) - BUDGET_ORDER.indexOf(b));
  const pace = Object.fromEntries(PACE_ORDER.map((p) => [p, 0])) as Record<PaceLevel, number>;
  for (const e of entries) pace[e.pace] += 1;
  const availability = { full: 0, partial: 0 };
  for (const e of entries) availability[e.availability.coverage] += 1;
  const counts = new Map<string, { kind: FlagRef["kind"]; flag: string; count: number }>();
  for (const e of entries) for (const o of e.safetyOverrides) {
    const key = `${o.kind}:${o.flag}`;
    counts.set(key, { kind: o.kind, flag: o.flag, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return {
    memberCount: entries.length,
    budget: { min: budgets[0], max: budgets[budgets.length - 1] },
    pace,
    availability,
    safetyOverrides: [...counts.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.flag.localeCompare(b.flag)),
  };
}
```
      (If the `alignmentSummarySchema.pace`/`safetyOverrides` zod is awkward, simplify to
      `z.record(z.string(), z.number())` / a plain object array — the test only checks
      `buildAlignmentSummary` output, not the schema. Keep the schema loose but present.)

- [ ] **Step 6: Create `lib/domain/trip-preview.ts`.**

```ts
import { z } from "zod";
import { budgetTierSchema, paceLevelSchema, calendarDateSchema } from "@/lib/domain/trip";

/** Shown before an invitee joins (spec §2.4). No private budget/health/veto detail. */
export const tripPreviewSchema = z.strictObject({
  organizerName: z.string().min(1),
  destinationName: z.string().nullable(),
  startDate: calendarDateSchema.nullable(),
  endDate: calendarDateSchema.nullable(),
  plannedDurationDays: z.number().int().min(1).max(14).nullable(),
  memberCount: z.number().int().min(1),
  proposedBudgetTier: budgetTierSchema.nullable(),
  pace: paceLevelSchema.nullable(),
});
export type TripPreview = z.infer<typeof tripPreviewSchema>;
```

- [ ] **Step 7: Update `lib/domain/chat-home.ts`.** Add to `chatHomeTripSchema`:
      `tripMode: tripModeSchema.nullable()`, `proposedBudgetTier: budgetTierSchema.nullable()`,
      `plannedDurationDays: z.number().int().min(1).max(14).nullable()`,
      `memberCount: z.number().int().min(1)`. Import `tripModeSchema`, `budgetTierSchema` from
      `@/lib/domain/trip`. Extend `tests/domain/chat-home.test.ts` with one case asserting a
      row parses with the new fields and rejects an unknown `tripMode`.

- [ ] **Step 8: Run all four new/changed domain tests — expect PASS.** `npm run typecheck`
      — expect only pre-existing Slice-2/3 breakage (wizard, actions). No new breakage in
      `lib/`.

- [ ] **Step 9: Commit** — `feat(trip): organizer trip-frame + member-entry contracts`.

---

## Task 3 — Migration `202609060004`: drop profile columns, rework `submit_user_onboarding`

**Files:**
- Create: `supabase/migrations/202609060004_travel_dna_safety_baseline.sql` (this task adds
  sections 1–2; Task 4 appends sections 3–5)
- Test: `tests/database/user-onboarding-rls.test.ts` (rewrite the profile + `submit_user_onboarding`
  describes)

- [ ] **Step 1: Rewrite the profile helpers + `submit_user_onboarding` describes in
      `tests/database/user-onboarding-rls.test.ts` (RED).** Replace the `quick`/`full`
      builders with one `answers` builder:

```ts
const answers = (over: Record<string, unknown> = {}) => ({
  dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
  surpriseDial: null,
  ...over,
});
async function submit(a: Record<string, unknown> = answers(), expectedRevision = 0, user = userA) {
  await actor(user);
  return db.query<{ submit_user_onboarding: number }>(
    "select public.submit_user_onboarding($1, $2::jsonb) as submit_user_onboarding",
    [expectedRevision, JSON.stringify(a)]);
}
```
      Cases to keep/adjust:
   - `user_travel_profiles RLS` — writes/reads self only; anon denied; `profile_revision`/
     `user_id` server-managed; **completed-shape now only requires an on-grid epsilon**
     (`update … set onboarding_completed_at = now(), serendipity_epsilon = 0.15` succeeds;
     `… serendipity_epsilon = 0.2` fails `23514`). Remove all `budget_lean`, `pace`,
     `social_role`, `mobility_threshold_m` references. Insert without those columns.
   - `submit_user_onboarding`:
     - first submit, no dial → row created, `serendipity_epsilon = "0.150"`,
       `onboarding_completed_at` not null, `travel_vibe` null, revision `1`.
     - submit with `surpriseDial: 5` on a fresh user → `serendipity_epsilon = "0.300"`.
     - redo with `surpriseDial: null` at the current revision → epsilon **preserved**;
       redo with `surpriseDial: 1` → epsilon becomes `"0.000"`, revision bumps.
     - dealbreakers add-only: `{ dietary: ["halal","no_peanut"], religiousAccess: ["prayer_space_needed"] }`
       → three `user_travel_constraints` rows with severities `standard/severe/standard`;
       a second submit re-listing `halal` does **not** duplicate.
     - `42501` anon; `40001` stale revision with **atomic rollback** (no `halal` row written);
     - `22023` for: `dealbreakers` not an object, an unknown flag, `surpriseDial: 9`,
       `surpriseDial: 2.5` — and nothing written.
     - severity parity: for every dietary/religious/mobility flag, the stored `severity`
       equals `defaultSeverity`/`defaultReligiousAccessSeverity`/`defaultMobilitySeverity`.

- [ ] **Step 2: Run — expect FAIL** (`create_trip_group` etc. still old; `submit_user_onboarding`
      still expects `mode`). Also the migrations-load `beforeAll` must now
      `expect(migrationFiles).toContain("202609060004_travel_dna_safety_baseline.sql")`.

- [ ] **Step 3: Write section 1 of `202609060004` — drop the four columns + re-shape the
      CHECK + grants.**

```sql
-- 202609060004 — safety-first Travel DNA pivot (spec revised 2026-09-07).
-- NOT purely additive: drops user_travel_profiles.{budget_lean,pace,social_role,
-- mobility_threshold_m}, which shipped in 202609060002 against the pre-pivot design and are
-- consumed only by tests. traveler_profiles + trip_constraints + the 202609060001 trip-scoped
-- RPC/route are untouched (compat window, spec §4).

-- 1. Shrink user_travel_profiles to the safety-only baseline.
alter table public.user_travel_profiles
  drop constraint user_travel_profiles_completed_shape,
  drop column budget_lean,
  drop column pace,
  drop column social_role,
  drop column mobility_threshold_m;

alter table public.user_travel_profiles add constraint user_travel_profiles_completed_shape
  check (onboarding_completed_at is null
         or serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3));

-- Grants: the dropped columns fell out of the column list automatically; restate for clarity.
revoke insert, update on public.user_travel_profiles from authenticated;
grant insert (user_id, travel_vibe, serendipity_epsilon, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;
grant update (travel_vibe, serendipity_epsilon, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;
```
      (`select, delete` grants and the four RLS policies from `202609060002` stay as-is.)

- [ ] **Step 4: Write section 2 — replace `submit_user_onboarding` body.** `create or replace`
      keeps the `(bigint, jsonb)` signature and existing grants. New body:

```sql
create or replace function public.submit_user_onboarding(p_expected_revision bigint, p_answers jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_revision bigint;
  v_prev_completed_at timestamptz;
  v_new_revision bigint;
  v_now timestamptz := now();
  v_dial int;
  v_epsilon numeric;
  v_kind text; v_flag text; v_severity public.trip_constraint_severity;
  v_dietary text[] := array['halal','vegetarian','vegan','no_seafood','no_shellfish','no_pork','no_beef','no_dairy','no_gluten','no_peanut','other'];
  v_religious text[] := array['modest_dress_required','prayer_space_needed','no_alcohol_venues','other'];
  v_mobility text[] := array['wheelchair_accessible_required','limited_walking_distance','no_stairs','other'];
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;

  if jsonb_typeof(p_answers->'dealbreakers') is distinct from 'object' then
    raise exception 'dealbreakers must be an object' using errcode = '22023';
  end if;
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'dietary', v_dietary);
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'religiousAccess', v_religious);
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'mobility', v_mobility);

  -- Optional exploration dial: absent / null = skip; otherwise integer 1..5.
  if (p_answers ? 'surpriseDial') and jsonb_typeof(p_answers->'surpriseDial') <> 'null' then
    if jsonb_typeof(p_answers->'surpriseDial') <> 'number'
       or (p_answers->>'surpriseDial')::numeric <> trunc((p_answers->>'surpriseDial')::numeric)
       or (p_answers->>'surpriseDial')::int < 1 or (p_answers->>'surpriseDial')::int > 5 then
      raise exception 'invalid surpriseDial' using errcode = '22023';
    end if;
    v_dial := (p_answers->>'surpriseDial')::int;
    v_epsilon := round((((v_dial - 1) / 4.0) * 0.3), 3);
  end if;

  select profile_revision, onboarding_completed_at into v_existing_revision, v_prev_completed_at
  from public.user_travel_profiles where user_id = v_user_id;
  if v_existing_revision is not null and v_existing_revision <> p_expected_revision then
    raise exception 'stale profile revision' using errcode = '40001';
  end if;
  if v_existing_revision is null and p_expected_revision <> 0 then
    raise exception 'stale profile revision' using errcode = '40001';
  end if;

  for v_kind, v_flag in
    select 'dietary', jsonb_array_elements_text(coalesce(p_answers->'dealbreakers'->'dietary', '[]'::jsonb))
    union all select 'religious_access', jsonb_array_elements_text(coalesce(p_answers->'dealbreakers'->'religiousAccess', '[]'::jsonb))
    union all select 'mobility', jsonb_array_elements_text(coalesce(p_answers->'dealbreakers'->'mobility', '[]'::jsonb))
  loop
    v_severity := case
      when v_kind = 'dietary' and v_flag in ('no_peanut', 'no_shellfish') then 'severe'
      when v_kind = 'mobility' and v_flag = 'wheelchair_accessible_required' then 'severe'
      else 'standard' end::public.trip_constraint_severity;
    insert into public.user_travel_constraints (user_id, kind, flag, severity, source, created_by, confirmed_at)
    values (v_user_id, v_kind::public.trip_constraint_kind, v_flag, v_severity, 'manual', v_user_id, v_now)
    on conflict (user_id, kind, flag) where retired_at is null do nothing;
  end loop;

  if v_existing_revision is null then
    insert into public.user_travel_profiles (user_id, onboarding_completed_at, serendipity_epsilon)
    values (v_user_id, v_now, coalesce(v_epsilon, 0.150))
    on conflict (user_id) do nothing
    returning profile_revision into v_new_revision;
    if v_new_revision is null then raise exception 'stale profile revision' using errcode = '40001'; end if;
  else
    update public.user_travel_profiles set
      onboarding_completed_at = v_now,
      serendipity_epsilon = case
        when v_epsilon is not null then v_epsilon
        when v_prev_completed_at is null then 0.150
        else public.user_travel_profiles.serendipity_epsilon end
    where user_id = v_user_id and profile_revision = p_expected_revision
    returning profile_revision into v_new_revision;
    if v_new_revision is null then raise exception 'stale profile revision' using errcode = '40001'; end if;
  end if;

  return v_new_revision;
end;
$$;
```

- [ ] **Step 4b: Fix the `202609060002` reference test** — the
      `202609060002 initializes existing trips to ready` describe still passes (unchanged
      behavior); no edit unless the fresh-DB load now errors. Also update the
      `user_travel_profiles RLS` insert helper in that same file to not pass `pace`.

- [ ] **Step 5: Run `tests/database/user-onboarding-rls.test.ts` — expect PASS** for the
      profile + `submit_user_onboarding` describes. `create_trip_group` + `trip_member_entries`
      describes still RED (Task 4). Also run `tests/database/travel-dna-backfill.test.ts` —
      expect RED (backfill fn references dropped columns); Task 5 fixes it.

- [ ] **Step 6: Commit** — `feat(db): shrink user_travel_profiles to the safety baseline`
      (migration section 1–2 + the two rewritten describes). Note in the message that
      `travel-dna-backfill.test.ts` is temporarily red pending `202609060005` in Task 5, or
      hold this commit until Task 5 is done and land Tasks 3–5 as one commit — reviewer's
      choice; prefer holding so `main` never has a red suite.

---

## Task 4 — Migration `202609060004` cont.: organizer `create_trip_group` + `trip_member_entries`

**Files:**
- Modify: `supabase/migrations/202609060004_travel_dna_safety_baseline.sql` (append sections 3–5)
- Test: `tests/database/user-onboarding-rls.test.ts` (rewrite `create_trip_group` describe;
  add `trip_member_entries` describe)

- [ ] **Step 1: Rewrite the `create_trip_group` describe + add `trip_member_entries` describe (RED).**

```ts
const frameArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  name: "Melaka crew", destination: "Melaka",
  start: "2026-12-12", end: "2026-12-14", duration: null,
  mode: "balanced", budget: null, split: false, ...over });
async function createFrame(o = frameArgs(), user = userA) {
  await actor(user);
  return db.query<{ id: string }>(
    "select public.create_trip_group($1,$2,$3::date,$4::date,$5::int,$6,$7,$8) as id",
    [o.name, o.destination, o.start, o.end, o.duration, o.mode, o.budget, o.split]);
}

describe("create_trip_group (organizer frame)", () => {
  it("creates a ready trip with a destination + valid date pair + owner membership", async () => {
    const id = (await createFrame()).rows[0].id;
    await actor(null, "postgres");
    const t = (await db.query("select name,status,destination_name,trip_mode,split_allowed,planned_duration_days from trips where id=$1", [id])).rows[0];
    expect(t).toMatchObject({ name: "Melaka crew", status: "ready", destination_name: "Melaka", trip_mode: "balanced", split_allowed: false, planned_duration_days: null });
    expect((await db.query("select 1 from trip_members where trip_id=$1 and user_id=$2 and role='owner'", [id, userA])).rows).toHaveLength(1);
  });
  it("creates a duration-only draft trip that still has destination + mode", async () => {
    const id = (await createFrame(frameArgs({ start: null, end: null, duration: 5 }))).rows[0].id;
    await actor(null, "postgres");
    const t = (await db.query("select status,destination_name,planned_duration_days from trips where id=$1", [id])).rows[0];
    expect(t).toMatchObject({ status: "draft", destination_name: "Melaka", planned_duration_days: 5 });
  });
  it("stores an optional proposed budget tier", async () => {
    const id = (await createFrame(frameArgs({ budget: "premium", split: true }))).rows[0].id;
    await actor(null, "postgres");
    expect((await db.query("select proposed_budget_tier,split_allowed from trips where id=$1", [id])).rows[0])
      .toEqual({ proposed_budget_tier: "premium", split_allowed: true });
  });
  it("rejects anon (42501), blank name/destination, an unknown mode, neither dates nor duration, an inverted range, and >14 days (22023)", async () => {
    await actor(null, "anon");
    await expect(db.query("select public.create_trip_group('n','d','2026-12-12'::date,'2026-12-14'::date,null,'balanced',null,false)")).rejects.toMatchObject({ code: "42501" });
    await expect(createFrame(frameArgs({ name: "   " }))).rejects.toMatchObject({ code: "22023" });
    await expect(createFrame(frameArgs({ destination: "  " }))).rejects.toMatchObject({ code: "22023" });
    await expect(createFrame(frameArgs({ mode: "party" }))).rejects.toMatchObject({ code: "22023" });
    await expect(createFrame(frameArgs({ start: null, end: null, duration: null }))).rejects.toMatchObject({ code: "22023" });
    await expect(createFrame(frameArgs({ start: "2026-12-14", end: "2026-12-12" }))).rejects.toMatchObject({ code: "22023" });
    await expect(createFrame(frameArgs({ start: "2026-12-01", end: "2026-12-30" }))).rejects.toMatchObject({ code: "22023" });
    await expect(createFrame(frameArgs({ start: null, end: null, duration: 15 }))).rejects.toMatchObject({ code: "22023" });
  });
});

describe("trip_member_entries + submit_member_entry + trip_alignment_summary", () => {
  const entry = (over = {}) => ({
    availability: { coverage: "full", arrivalDate: null, departureDate: null },
    budgetTier: "standard", pace: "balanced", safetyOverrides: [], ...over });
  async function submitEntry(tripId: string, e = entry(), user = userA) {
    await actor(user);
    return db.query("select public.submit_member_entry($1::uuid, $2::jsonb)", [tripId, JSON.stringify(e)]);
  }
  it("lets a member upsert their own entry and denies a non-member (42501)", async () => {
    const id = (await createFrame()).rows[0].id;               // userA owner
    await expect(submitEntry(id)).resolves.toBeDefined();
    await expect(submitEntry(id, entry({ pace: "active" }))).resolves.toBeDefined(); // upsert
    await actor(null, "postgres");
    expect((await db.query("select count(*)::int n from trip_member_entries where trip_id=$1", [id])).rows[0].n).toBe(1);
    expect((await db.query("select pace from trip_member_entries where trip_id=$1 and user_id=$2", [id, userA])).rows[0].pace).toBe("active");
    await expect(submitEntry(id, entry(), userB)).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects a malformed entry (22023) and writes nothing", async () => {
    const id = (await createFrame()).rows[0].id;
    await expect(submitEntry(id, entry({ budgetTier: "cheap" }))).rejects.toMatchObject({ code: "22023" });
    await expect(submitEntry(id, entry({ availability: { coverage: "partial", arrivalDate: null, departureDate: null } }))).rejects.toMatchObject({ code: "22023" });
    await actor(null, "postgres");
    expect((await db.query("select count(*)::int n from trip_member_entries where trip_id=$1", [id])).rows[0].n).toBe(0);
  });
  it("trip_alignment_summary returns aggregate-only jsonb with no user ids, and null below the floor", async () => {
    const id = (await createFrame()).rows[0].id;               // userA owner
    await actor(null, "postgres");
    await db.query("insert into trip_members(trip_id,user_id,role) values ($1,$2,'member')", [id, userB]);
    await submitEntry(id, entry({ budgetTier: "budget", pace: "relaxed" }), userA);
    await actor(userA);
    expect((await db.query("select public.trip_alignment_summary($1::uuid) as s", [id])).rows[0].s).toBeNull(); // 1 entry
    await submitEntry(id, entry({ budgetTier: "premium", safetyOverrides: [{ kind: "dietary", flag: "halal" }] }), userB);
    await actor(userA);
    const s = (await db.query<{ s: any }>("select public.trip_alignment_summary($1::uuid) as s", [id])).rows[0].s;
    expect(s.memberCount).toBe(2);
    expect(s.budget).toMatchObject({ min: "budget", max: "premium" });
    expect(JSON.stringify(s)).not.toMatch(new RegExp(userA + "|" + userB));
    expect(JSON.stringify(s)).not.toMatch(/user_id|"id"/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Append section 3 — `trip_mode` enum + `trips` columns + grant.**

```sql
-- 3. Organizer trip frame — broad mode, proposed budget, split permission, planned duration.
create type public.trip_mode as enum ('relaxed', 'balanced', 'adventurous', 'mixed');

alter table public.trips
  add column trip_mode public.trip_mode,
  add column proposed_budget_tier public.budget_tier,
  add column split_allowed boolean not null default false,
  add column planned_duration_days int
    check (planned_duration_days is null or planned_duration_days between 1 and 14);

grant insert (trip_mode, proposed_budget_tier, split_allowed, planned_duration_days)
  on public.trips to authenticated;
```
      (`trips_promote_when_ready` from `202609060002` still governs `draft`→`ready`; a
      duration-only row has null dates so it stays `draft` — no trigger change needed.)

- [ ] **Step 4: Append section 3b — replace `create_trip_group`.** Different arg list ⇒ drop
      + create.

```sql
drop function public.create_trip_group(text);

create function public.create_trip_group(
  p_name text, p_destination text, p_start_date date, p_end_date date,
  p_duration_days int, p_trip_mode text, p_proposed_budget_tier text, p_split_allowed boolean
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_name text := public.ordinary_trim(coalesce(p_name, ''));
  v_dest text := public.ordinary_trim(coalesce(p_destination, ''));
  v_has_pair boolean := p_start_date is not null and p_end_date is not null;
  v_has_duration boolean := p_duration_days is not null;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'a group name is required (1-120 characters)' using errcode = '22023'; end if;
  if char_length(v_dest) not between 1 and 120 then
    raise exception 'a destination is required (1-120 characters)' using errcode = '22023'; end if;
  if p_trip_mode is null or p_trip_mode not in ('relaxed','balanced','adventurous','mixed') then
    raise exception 'invalid trip mode' using errcode = '22023'; end if;
  if not v_has_pair and not v_has_duration then
    raise exception 'trip dates or a duration are required' using errcode = '22023'; end if;
  if (p_start_date is null) <> (p_end_date is null) then
    raise exception 'provide both a start and an end date, or neither' using errcode = '22023'; end if;
  if v_has_pair and (p_end_date < p_start_date or (p_end_date - p_start_date) > 13) then
    raise exception 'trip dates must be a 1-14 day range' using errcode = '22023'; end if;
  if v_has_duration and p_duration_days not between 1 and 14 then
    raise exception 'duration must be 1-14 days' using errcode = '22023'; end if;
  if p_proposed_budget_tier is not null
     and p_proposed_budget_tier not in ('budget','standard','premium','luxury') then
    raise exception 'invalid proposed budget tier' using errcode = '22023'; end if;

  insert into public.trips
    (name, owner_user_id, destination_name, start_date, end_date,
     planned_duration_days, trip_mode, proposed_budget_tier, split_allowed)
  values
    (v_name, auth.uid(), v_dest, p_start_date, p_end_date,
     case when v_has_pair then null else p_duration_days end,
     p_trip_mode::public.trip_mode,
     p_proposed_budget_tier::public.budget_tier,
     coalesce(p_split_allowed, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_trip_group(text, text, date, date, int, text, text, boolean) from public, anon;
grant execute on function public.create_trip_group(text, text, date, date, int, text, text, boolean) to authenticated;
```
      **Verify** `trips_destination_bounds` / `trips_ready_requires_setup` (from
      `202609030004` / `202609060002`) accept a `ready` row created this way — a valid pair +
      non-blank destination satisfies `trips_ready_requires_setup`; a duration-only row is
      `draft` so the check passes vacuously.

- [ ] **Step 5: Append section 4 — `trip_member_entries` + RLS.**

```sql
-- 4. Per-trip member entry (availability, budget, pace, safety overrides). Self-only RLS;
--    the aggregate summary is exposed only through a SECURITY DEFINER function (spec §6).
create table public.trip_member_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  availability_coverage text not null check (availability_coverage in ('full', 'partial')),
  arrival_date date,
  departure_date date,
  budget_tier public.budget_tier not null,
  pace public.pace_level not null,
  safety_overrides jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, user_id),
  constraint trip_member_entries_partial_needs_a_date check (
    availability_coverage <> 'partial' or arrival_date is not null or departure_date is not null),
  constraint trip_member_entries_overrides_is_array check (jsonb_typeof(safety_overrides) = 'array')
);
create index trip_member_entries_trip_idx on public.trip_member_entries (trip_id);

alter table public.trip_member_entries enable row level security;
revoke all on public.trip_member_entries from public, anon, authenticated, service_role;
grant select, insert, update on public.trip_member_entries to authenticated;
create policy "self read" on public.trip_member_entries
  for select to authenticated using (user_id = auth.uid());
create policy "self write" on public.trip_member_entries
  for insert to authenticated with check (user_id = auth.uid());
create policy "self update" on public.trip_member_entries
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger trip_member_entries_touch before update on public.trip_member_entries
  for each row execute function public.set_updated_at();
```
      **Check** `public.set_updated_at()` exists (used by other tables). If the repo's helper
      has another name, use that; otherwise inline a 3-line trigger fn with
      `revoke all … from public, anon, service_role`.

- [ ] **Step 6: Append section 5 — `submit_member_entry` + `trip_alignment_summary`.**

```sql
create function public.submit_member_entry(p_trip_id uuid, p_entry jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_cov text := p_entry->'availability'->>'coverage';
  v_arr date; v_dep date; v_budget text := p_entry->>'budgetTier'; v_pace text := p_entry->>'pace';
  v_over jsonb := coalesce(p_entry->'safetyOverrides', '[]'::jsonb);
  v_o jsonb;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = v_user) then
    raise exception 'not a member of this trip' using errcode = '42501';
  end if;
  if v_cov is null or v_cov not in ('full', 'partial') then
    raise exception 'invalid availability coverage' using errcode = '22023'; end if;
  begin
    v_arr := nullif(p_entry->'availability'->>'arrivalDate', '')::date;
    v_dep := nullif(p_entry->'availability'->>'departureDate', '')::date;
  exception when others then raise exception 'invalid availability date' using errcode = '22023'; end;
  if v_cov = 'partial' and v_arr is null and v_dep is null then
    raise exception 'partial availability needs a date' using errcode = '22023'; end if;
  if v_budget is null or v_budget not in ('budget','standard','premium','luxury') then
    raise exception 'invalid budget tier' using errcode = '22023'; end if;
  if v_pace is null or v_pace not in ('relaxed','balanced','active','intense') then
    raise exception 'invalid pace' using errcode = '22023'; end if;
  if jsonb_typeof(v_over) <> 'array' then
    raise exception 'safetyOverrides must be an array' using errcode = '22023'; end if;
  for v_o in select * from jsonb_array_elements(v_over) loop
    if (v_o->>'kind') not in ('dietary','religious_access','mobility') or (v_o->>'flag') is null then
      raise exception 'invalid safety override' using errcode = '22023'; end if;
  end loop;

  insert into public.trip_member_entries
    (trip_id, user_id, availability_coverage, arrival_date, departure_date, budget_tier, pace, safety_overrides)
  values (p_trip_id, v_user, v_cov, v_arr, v_dep, v_budget::public.budget_tier, v_pace::public.pace_level, v_over)
  on conflict (trip_id, user_id) do update set
    availability_coverage = excluded.availability_coverage,
    arrival_date = excluded.arrival_date, departure_date = excluded.departure_date,
    budget_tier = excluded.budget_tier, pace = excluded.pace,
    safety_overrides = excluded.safety_overrides, updated_at = now();
end;
$$;
revoke all on function public.submit_member_entry(uuid, jsonb) from public, anon;
grant execute on function public.submit_member_entry(uuid, jsonb) to authenticated;

-- Aggregate, non-attributable (spec §2.4 / §6). SECURITY DEFINER so a member sees the shape
-- without RLS-reading peers' rows; returns null below the 2-entry de-anonymization floor.
create function public.trip_alignment_summary(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int; v_result jsonb; v_caller uuid := auth.uid();
begin
  if v_caller is null
     or not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = v_caller) then
    raise exception 'not a member of this trip' using errcode = '42501';
  end if;
  select count(*) into v_n from public.trip_member_entries e where e.trip_id = p_trip_id;
  if v_n < 2 then return null; end if;
  select jsonb_build_object(
    'memberCount', v_n,
    'budget', jsonb_build_object(
      'min', (select e.budget_tier from public.trip_member_entries e where e.trip_id = p_trip_id
              order by array_position(array['budget','standard','premium','luxury']::text[], e.budget_tier::text) asc limit 1),
      'max', (select e.budget_tier from public.trip_member_entries e where e.trip_id = p_trip_id
              order by array_position(array['budget','standard','premium','luxury']::text[], e.budget_tier::text) desc limit 1)),
    'pace', (select jsonb_object_agg(p, c) from (
      select x.p, count(e.*)::int c from unnest(array['relaxed','balanced','active','intense']) x(p)
      left join public.trip_member_entries e on e.trip_id = p_trip_id and e.pace::text = x.p
      group by x.p) q),
    'availability', jsonb_build_object(
      'full', (select count(*)::int from public.trip_member_entries e where e.trip_id = p_trip_id and e.availability_coverage = 'full'),
      'partial', (select count(*)::int from public.trip_member_entries e where e.trip_id = p_trip_id and e.availability_coverage = 'partial')),
    'safetyOverrides', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'flag', f, 'count', c) order by k, f) from (
      select o->>'kind' k, o->>'flag' f, count(*)::int c
      from public.trip_member_entries e, jsonb_array_elements(e.safety_overrides) o
      where e.trip_id = p_trip_id group by 1, 2) s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.trip_alignment_summary(uuid) from public, anon;
grant execute on function public.trip_alignment_summary(uuid) to authenticated;
```

- [ ] **Step 7: Run `tests/database/user-onboarding-rls.test.ts` — expect PASS** (all
      describes). Fix the pre-existing `create_trip_group + draft trips` describe name/body
      that referenced the old signature (now replaced by the two describes above) — delete
      the stale one.

- [ ] **Step 8: Commit** — `feat(db): organizer create_trip_group frame + trip_member_entries`.

---

## Task 5 — Migration `202609060005`: rework the backfill

**Files:**
- Create: `supabase/migrations/202609060005_travel_dna_backfill_v2.sql`
- Test: `tests/database/travel-dna-backfill.test.ts` (adjust column expectations)

- [ ] **Step 1: Read `tests/database/travel-dna-backfill.test.ts`** and change every
      assertion that reads `budget_lean`, `pace`, `social_role`, `mobility_threshold_m` off
      `user_travel_profiles` to read only `travel_vibe`, `serendipity_epsilon`,
      `onboarding_completed_at`, `backfilled_from_trip_member_id`. Keep the idempotency test
      (calls `_run_travel_dna_backfill()` twice → same row counts) and the
      `travel_dna_backfill_report` assertions (drop `budget_lean is not null` from any
      expected predicate text). RED.

- [ ] **Step 2: Write `202609060005`.** `create or replace` the function so re-runs stay
      idempotent; the migration body calls it once.

```sql
-- 202609060005 — rework the Travel DNA backfill for the safety-only profile (spec revised
-- 2026-09-07). 202609060003 already ran once against the pre-pivot columns; those columns
-- are gone after 202609060004, so replace the function + report to match. Still additive,
-- still idempotent (on-conflict-do-nothing), nothing dropped.

create or replace function public._run_travel_dna_backfill()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- 1. One global profile per user: newest completed traveler_profiles row. Only travel_vibe
  --    + serendipity_epsilon survive on user_travel_profiles now.
  insert into public.user_travel_profiles
    (user_id, travel_vibe, serendipity_epsilon, onboarding_completed_at, backfilled_from_trip_member_id)
  select distinct on (tm.user_id)
    tm.user_id, tp.travel_vibe, tp.serendipity_epsilon, tp.onboarding_completed_at, tp.trip_member_id
  from public.traveler_profiles tp
  join public.trip_members tm on tm.id = tp.trip_member_id
  where tp.onboarding_completed_at is not null
    and tm.user_id is not null
    and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3)
  order by tm.user_id, tp.onboarding_completed_at desc, tp.updated_at desc, tp.trip_member_id desc
  on conflict (user_id) do nothing;

  -- 2. Global constraints: unchanged from 202609060003 — confirmed, manual, non-'other'
  --    dietary/religious/mobility rows, deduped per (user, kind, flag).
  insert into public.user_travel_constraints
    (user_id, kind, flag, severity, source, created_by, created_at, confirmed_at,
     backfilled_from_trip_constraint_id)
  select distinct on (tm.user_id, tc.kind, tc.flag)
    tm.user_id, tc.kind, tc.flag,
    (case when tc.kind = 'dietary' and tc.flag in ('no_peanut','no_shellfish') then 'severe'
          when tc.kind = 'mobility' and tc.flag = 'wheelchair_accessible_required' then 'severe'
          else 'standard' end)::public.trip_constraint_severity,
    'manual'::public.trip_constraint_source, tm.user_id,
    min(tc.created_at) over (partition by tm.user_id, tc.kind, tc.flag),
    min(tc.confirmed_at) over (partition by tm.user_id, tc.kind, tc.flag),
    tc.id
  from public.trip_constraints tc
  join public.trip_members tm on tm.id = tc.trip_member_id
  where tc.confirmed_at is not null and tc.source = 'manual' and tm.user_id is not null
    and tc.kind in ('dietary','religious_access','mobility') and tc.flag <> 'other'
  order by tm.user_id, tc.kind, tc.flag, tc.confirmed_at asc, tc.id asc
  on conflict (user_id, kind, flag) where retired_at is null do nothing;
end;
$$;
revoke all on function public._run_travel_dna_backfill() from public, anon, authenticated, service_role;

select public._run_travel_dna_backfill();

drop view if exists public.travel_dna_backfill_report;
create view public.travel_dna_backfill_report with (security_invoker = true) as
select
  (select count(distinct tm.user_id) from public.traveler_profiles tp
     join public.trip_members tm on tm.id = tp.trip_member_id
     where tp.onboarding_completed_at is not null and tm.user_id is not null
       and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3)) as eligible_source_users,
  (select count(*) from public.user_travel_profiles where backfilled_from_trip_member_id is not null) as backfilled_profiles,
  (select count(*) from public.user_travel_profiles where backfilled_from_trip_member_id is null) as native_profiles,
  (select count(*) from public.user_travel_constraints where backfilled_from_trip_constraint_id is not null) as backfilled_constraints,
  (select count(distinct (tm.user_id, tc.kind, tc.flag)) from public.trip_constraints tc
     join public.trip_members tm on tm.id = tc.trip_member_id
     where tc.confirmed_at is not null and tc.source = 'manual' and tm.user_id is not null
       and tc.kind in ('dietary','religious_access','mobility') and tc.flag <> 'other') as eligible_constraint_keys,
  (select count(*) from public.trip_constraints tc
     join public.trip_members tm on tm.id = tc.trip_member_id
     where tc.confirmed_at is not null and tm.user_id is not null
       and (tc.source <> 'manual' or tc.flag = 'other'
            or tc.kind not in ('dietary','religious_access','mobility'))) as skipped_ambiguous_or_inferred_rows;
revoke all on public.travel_dna_backfill_report from public, anon, authenticated, service_role;
comment on view public.travel_dna_backfill_report is
  'Task 3 backfill audit, reworked for the safety-only profile (202609060005). Admin-only.';
```

- [ ] **Step 3: Run `tests/database/travel-dna-backfill.test.ts` — expect PASS.**

- [ ] **Step 4: Full sweep.** `npm run lint`, `npm run typecheck`, `npm test`,
      `npm run build`. `typecheck` may still flag `components/onboarding-wizard.tsx` and
      `app/actions/onboarding.ts` for removed fields — that is Slice 2's surface, but
      **`npm test` and `npm run build` must both be green**. If `next build` fails compiling
      the wizard, apply the smallest inert edit that makes it compile (e.g. keep the old
      draft fields local with literal defaults, still POSTing the reduced `answers` shape) —
      note it for Slice 2 to replace wholesale.

- [ ] **Step 5: Commit** — `feat(db): rework Travel DNA backfill for the safety baseline`.

- [ ] **Step 6: Update the umbrella plan** — tick Slice 1 in
      `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md` and note any deviations
      (invented `trip_mode` values, the wizard stopgap). Do **not** touch
      `docs/implementation-status.md` yet (Slice 6 owns status updates per shipped behavior).

---

## Self-review (run before handing Slice 1 off)

1. **Spec coverage (this slice):** §3.1 profile shape ✔ (Task 3); §3.1 constraints unchanged
   ✔; §3.3 organizer frame ✔ (Task 4); §2.4 preview + member entry + non-attributable
   summary ✔ (Task 2 domain, Task 4 DB); §4.3 deterministic backfill ✔ (Task 5); §4.1 "don't
   drop historical tables" ✔ (only `user_travel_profiles` *columns* drop; `traveler_profiles`
   intact).
2. **Placeholder scan:** every SQL/TS block above is literal. No "add validation"/"handle
   edge cases".
3. **Type/signature consistency:** `submit_user_onboarding(bigint, jsonb)`,
   `create_trip_group(text,text,date,date,int,text,text,boolean)`,
   `submit_member_entry(uuid,jsonb)`, `trip_alignment_summary(uuid)` — identical in the
   migration, the tests, and the umbrella header. `OnboardingAnswers.surpriseDial: number|null`
   matches the RPC's "absent/null = skip". `TRIP_MODES` (TS) === `public.trip_mode` enum ===
   the `create_trip_group` `in (...)` list === the domain test's expected array.
4. **Grep gates before editing:** `create_trip_group`, `createTripGroupSchema`,
   `submit_user_onboarding`, `budget_lean`, `social_role` — confirm every hit is a test or
   this slice's own file before changing it.
