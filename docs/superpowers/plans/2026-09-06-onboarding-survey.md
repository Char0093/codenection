# Onboarding Survey (Travel DNA) — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trip member complete a compact five-screen travel-preference survey (with a Quick mode) whose answers persist atomically across `traveler_profiles` and `trip_constraints`, and nudge members who have not completed it.

**Architecture:** A new Postgres migration adds soft-baseline columns + an optimistic-concurrency token to `traveler_profiles`, a completed-profile CHECK, a composite FK closing an RLS gap, and a single `security invoker` RPC `submit_onboarding(...)` that validates input, applies add-only dealbreaker constraints, and upserts the profile — all in one transaction. A pure domain module holds the Zod schemas and dial→epsilon math. Two server actions (`getMyOnboarding`, `getOnboardingNeeded`) read; `submitOnboarding` calls the RPC and maps SQLSTATEs to `AppError`. A client wizard component drives the five screens; a dedicated route hosts it; a small shared banner component nudges from the dashboard and the workspace.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Zod v4, Supabase (Postgres + RLS, user-token only), Vitest + Testing Library + PGlite.

**Spec:** `docs/superpowers/specs/2026-09-06-onboarding-survey-slice-design.md` (implements `Implementation_Plan.md` §II-a + Task 1.6, first slice only).

## Global Constraints

- Runtime uses the signed-in user's Supabase token and RLS — **never** a service-role key.
- Dealbreakers are written **only** through the existing typed `trip_constraints` self-confirmed path (`confirmed_by = <own member id>`, `confirmed_at = now()`), never a second constraint system. This slice is **add-only**: no delete, no downgrade, no supersession (deferred to Task 1.3).
- `social_role`, `budget_lean`, `travel_vibe` are private: never returned in any API response readable by another member. `traveler_profiles` RLS is already self-read-only; keep it that way.
- SQL is snake_case; TypeScript and JSON payloads are camelCase.
- New migration file: `supabase/migrations/202609060001_onboarding_profile.sql`. It must apply cleanly, in sequence, in `tests/database/migrations.test.ts`'s PGlite run.
- `serendipity_epsilon` grid = `{0.0, 0.075, 0.15, 0.225, 0.3}`; `SURPRISE_DIAL_DEFAULT = 3` → `0.15`.
- Severity defaults (must match `lib/domain/constraints.ts`): `dietary` `no_peanut`/`no_shellfish` → `severe`; `mobility` `wheelchair_accessible_required` → `severe`; every other supported flag → `standard`.
- No emoji in UI copy.
- Verification commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Vitest: component tests start with `// @vitest-environment jsdom`; run a single file with `npx vitest run <path>`, a single test with `npx vitest run <path> -t "<name>"`.

---

## File Structure

**Create**

| File | Responsibility |
| --- | --- |
| `supabase/migrations/202609060001_onboarding_profile.sql` | Schema columns, enum, triggers, composite FK, grants, completed-profile CHECK, `submit_onboarding` RPC. |
| `lib/domain/onboarding.ts` | Pure: vibe/social-role/walking-cap vocab + labels, `surpriseDialToEpsilon` / `epsilonToSurpriseDial` / `SURPRISE_DIAL_DEFAULT`, `onboardingAnswersSchema`, `submitBodySchema`, `OnboardingSnapshot` type. No I/O. Client-safe. |
| `app/actions/onboarding.ts` | `"use server"`: `getMyOnboarding(tripId)`, `getOnboardingNeeded(tripId)`, `submitOnboarding(tripId, rawBody)`. Internal `mapRpcError`. |
| `app/api/trips/[tripId]/onboarding/route.ts` | `GET` → `getMyOnboarding`; `POST` → `submitOnboarding`. Wrapper style from `constraints/route.ts`. |
| `components/onboarding-wizard.tsx` | `"use client"`: five-screen + Quick-mode wizard, nav gating, `reseed`, submit + reload. |
| `components/travel-dna-nudge.tsx` | `"use client"`: dismissible banner, per-trip `sessionStorage` key, links to the onboarding route. |
| `app/trips/[tripId]/onboarding/page.tsx` | Server: auth-guard, load trip + snapshot, render the wizard with `successHref`. |
| `tests/domain/onboarding.test.ts` | Unit tests for the pure module. |
| `tests/database/onboarding-rls.test.ts` | PGlite: schema, CHECK, grants, composite FK, and full `submit_onboarding` behavior. |
| `tests/components/onboarding-wizard.test.tsx` | Wizard behavior. |
| `tests/components/travel-dna-nudge.test.tsx` | Banner behavior. |
| `tests/api/onboarding.test.ts` | Route: GET shape, POST same-origin, 422, 409 mapping. |

**Modify**

| File | Change |
| --- | --- |
| `app/api/trips/[tripId]/route.ts` | Add `needsOnboarding` to the `GET` payload via `getOnboardingNeeded`. |
| `components/trip-setup-dashboard.tsx` | `TripDetail` gains `needsOnboarding`; track it on load / switch / refresh / reset; render `<TravelDnaNudge>` in the Setup panel. |
| `app/trips/[tripId]/workspace/page.tsx` | Fetch `getOnboardingNeeded`, pass to `WorkspaceClient`. |
| `features/workspace/workspace-client.tsx` | New `needsOnboarding` prop; render `<TravelDnaNudge>` above the shell. |
| `app/globals.css` | `.onboarding-*` and `.travel-dna-nudge` classes. |
| `tests/api/routes.test.ts` | Existing "returns trip and persisted proposals together" test: mock `@/app/actions/onboarding` and add `needsOnboarding` to the expected object. |
| `tests/components/trip-setup-dashboard.test.tsx` | `load()` detail fixture gains `needsOnboarding`; add one banner test. |
| `docs/implementation-status.md` | Task 1.6 → Partial, with the add-only caveat + deferred list. |

---

## Task 1: Pure domain module

**Files:**
- Create: `lib/domain/onboarding.ts`
- Test: `tests/domain/onboarding.test.ts`

**Interfaces:**
- Consumes: `budgetTierSchema`, `paceLevelSchema`, `BudgetTier`, `PaceLevel` from `lib/domain/trip.ts`; `dietaryFlagSchema`, `religiousAccessFlagSchema`, `mobilityFlagSchema`, `DIETARY_FLAGS`, `RELIGIOUS_ACCESS_FLAGS`, `MOBILITY_FLAGS`, `DietaryFlag`, `ReligiousAccessFlag`, `MobilityFlag` from `lib/domain/constraints.ts`.
- Produces:
  - `TRAVEL_VIBES: readonly ["heritage","food","nature","urban"]`, `TravelVibe`, `travelVibeSchema`, `TRAVEL_VIBE_LABELS`
  - `SOCIAL_ROLES: readonly ["navigator","chronicler","gourmand","go_with_the_flow","negotiator"]`, `SocialRole`, `socialRoleSchema`, `SOCIAL_ROLE_LABELS`
  - `WALKING_CAP_PRESETS: readonly { value: number | null; label: string }[]`
  - `SURPRISE_DIAL_DEFAULT = 3`
  - `surpriseDialToEpsilon(dial: number): number` — throws on non-1..5-integer
  - `epsilonToSurpriseDial(epsilon: number): number` — nearest grid index + 1
  - `onboardingAnswersSchema` (discriminated union on `mode`), `OnboardingAnswers`
  - `submitBodySchema` = `{ expectedRevision: number; answers: OnboardingAnswers }`
  - `OnboardingSnapshot` type

- [ ] **Step 1: Write the failing test**

Create `tests/domain/onboarding.test.ts`:

```ts
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
  it("returns the nearest dial for a stored epsilon", () => {
    expect(epsilonToSurpriseDial(0)).toBe(1);
    expect(epsilonToSurpriseDial(0.15)).toBe(3);
    expect(epsilonToSurpriseDial(0.3)).toBe(5);
    // 0.2 is 0.025 from grid value 0.225 (dial 4) and 0.05 from 0.15 (dial 3) -> 4.
    expect(epsilonToSurpriseDial(0.2)).toBe(4);
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
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/domain/onboarding.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/onboarding'`.

- [ ] **Step 3: Implement `lib/domain/onboarding.ts`**

```ts
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
  let bestIndex = 0;
  let bestDistance = Infinity;
  EPSILON_GRID.forEach((value, index) => {
    const distance = Math.abs(value - epsilon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex + 1;
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/domain/onboarding.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint lib/domain/onboarding.ts tests/domain/onboarding.test.ts`
Expected: no errors. If `z.enum(TRAVEL_VIBES)` complains about a readonly tuple, confirm the surrounding pattern in `lib/domain/constraints.ts` (`z.enum(DIETARY_FLAGS)`) and match it.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/onboarding.ts tests/domain/onboarding.test.ts
git commit -m "feat(onboarding): pure survey schema + dial/epsilon helpers"
```

---

## Task 2: Migration — schema, triggers, FK, grants, CHECK

**Files:**
- Create: `supabase/migrations/202609060001_onboarding_profile.sql`
- Test: `tests/database/onboarding-rls.test.ts`

**Interfaces:**
- Consumes: existing `public.traveler_profiles`, `public.trip_members`, `public.trips`, `public.budget_tier`, `public.pace_level`, `public.can_manage_trip(uuid)`, and the RLS policy `"members or managers update traveler profiles"` from `202609050006_traveler_profiles_poi_catalog.sql`.
- Produces (for Task 3, same file): enum `public.traveler_travel_vibe`; columns `traveler_profiles.travel_vibe`, `.budget_lean`, `.onboarding_completed_at`, `.profile_revision`; constraint `traveler_profiles_completed_shape`; constraint `trip_members_trip_id_id_key`; FK `traveler_profiles_member_in_trip_fk`; triggers `traveler_profiles_set_initial_revision`, `traveler_profiles_bump_revision`.

- [ ] **Step 1: Write the failing test**

Create `tests/database/onboarding-rls.test.ts`. This file follows `tests/database/constraints-rls.test.ts` exactly for harness setup. Start with the harness + schema/grant/CHECK/FK cases; Task 3 appends the RPC cases.

```ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DIETARY_FLAGS, RELIGIOUS_ACCESS_FLAGS, MOBILITY_FLAGS, defaultSeverity, defaultReligiousAccessSeverity, defaultMobilitySeverity } from "@/lib/domain/constraints";

const migrationDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const tripOwner = "00000000-0000-4000-8000-000000000200";
const member = "00000000-0000-4000-8000-000000000202";
const otherMember = "00000000-0000-4000-8000-000000000203";
const stranger = "00000000-0000-4000-8000-000000000204";

let db: PGlite;
let trip: string;
let otherTrip: string;
let memberMemberId: string;
let otherMemberId: string;          // a member row on `trip`
let foreignMemberId: string;        // a member row on `otherTrip`, same user as `member`

async function actor(user: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
}

/** Call the RPC as `member` with sane defaults; override via `answers`. */
async function submit(answers: Record<string, unknown>, expectedRevision = 0, actingUser = member) {
  await actor(actingUser);
  return db.query<{ submit_onboarding: string }>(
    "select public.submit_onboarding($1, $2, $3::jsonb) as submit_onboarding",
    [trip, expectedRevision, JSON.stringify(answers)],
  );
}

const quick = (over: Record<string, unknown> = {}) => ({
  mode: "quick",
  dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
  walkingCapM: null,
  budgetLean: "standard",
  ...over,
});
const full = (over: Record<string, unknown> = {}) => ({
  mode: "full",
  dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
  walkingCapM: 2000,
  budgetLean: "standard",
  vibe: "food",
  pace: "active",
  socialRole: "gourmand",
  surpriseDial: 3,
  ...over,
});

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key);
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('sub', auth.uid(), 'email', 'test@example.invalid') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  expect(migrations).toContain("202609060001_onboarding_profile.sql");
  for (const name of migrations) {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8")
      .replace(/^create extension if not exists pgcrypto;\s*$/gim, "");
    await db.exec(sql);
  }
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [tripOwner, member, otherMember, stranger]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }
  trip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'KL trip','Kuala Lumpur','2026-12-12','2026-12-14') returning id`, [tripOwner])).rows[0].id;
  otherTrip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'Melaka trip','Melaka','2026-12-20','2026-12-22') returning id`, [tripOwner])).rows[0].id;
  memberMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Member','member') returning id`, [trip, member])).rows[0].id;
  otherMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Other','member') returning id`, [trip, otherMember])).rows[0].id;
  foreignMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Member elsewhere','member') returning id`, [otherTrip, member])).rows[0].id;
  await actor(member);
});
afterAll(async () => { await db?.close(); });

describe("202609060001 schema", () => {
  it("adds the four traveler_profiles columns with the right defaults", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    const row = (await db.query<{ profile_revision: string; onboarding_completed_at: string | null; travel_vibe: string | null; budget_lean: string | null }>(
      "select profile_revision, onboarding_completed_at, travel_vibe, budget_lean from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(row.profile_revision).toBe("1");
    expect(row.onboarding_completed_at).toBeNull();
    expect(row.travel_vibe).toBeNull();
    expect(row.budget_lean).toBeNull();
  });

  it("bumps profile_revision and updated_at on every update, ignoring any supplied value", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    await db.query(`update traveler_profiles set pace='relaxed' where trip_member_id=$1`, [memberMemberId]);
    let row = (await db.query<{ profile_revision: string }>(
      "select profile_revision from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(row.profile_revision).toBe("2");
  });

  it("rejects a client insert or update that names profile_revision or trip_id", async () => {
    await actor(member);
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id,profile_revision) values ($1,$2,99)`,
      [trip, memberMemberId])).rejects.toMatchObject({ code: "42501" });
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    await expect(db.query(`update traveler_profiles set trip_id=$1 where trip_member_id=$2`, [otherTrip, memberMemberId]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("enforces the completed-profile shape", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    // completed but no budget_lean -> rejected
    await expect(db.query(
      `update traveler_profiles set onboarding_completed_at=now() where trip_member_id=$1`, [memberMemberId],
    )).rejects.toMatchObject({ code: "23514" });
    // completed with off-grid epsilon -> rejected
    await expect(db.query(
      `update traveler_profiles set onboarding_completed_at=now(), budget_lean='standard', serendipity_epsilon=0.2 where trip_member_id=$1`,
      [memberMemberId],
    )).rejects.toMatchObject({ code: "23514" });
    // completed, budget_lean set, on-grid epsilon -> ok
    await expect(db.query(
      `update traveler_profiles set onboarding_completed_at=now(), budget_lean='standard', serendipity_epsilon=0.15 where trip_member_id=$1`,
      [memberMemberId],
    )).resolves.toBeDefined();
  });

  it("rejects a traveler_profiles row whose member belongs to another trip (composite FK)", async () => {
    await actor(null, "postgres");
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`,
      [trip, foreignMemberId])).rejects.toMatchObject({ code: "23503" });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/database/onboarding-rls.test.ts`
Expected: FAIL — `expect(migrations).toContain("202609060001_onboarding_profile.sql")` fails (file missing).

- [ ] **Step 3: Create the migration (schema portion only)**

Create `supabase/migrations/202609060001_onboarding_profile.sql`:

```sql
-- Implementation_Plan.md Task 1.6 (slice 1): onboarding survey persistence.
-- Adds the soft-baseline columns + an optimistic-concurrency token to traveler_profiles,
-- a completed-profile shape CHECK, the composite (trip_id, member) FK that closes the
-- 202609050006 UPDATE-policy invariant gap, column-scoped grants, and the transactional
-- submit_onboarding RPC. See docs/superpowers/specs/2026-09-06-onboarding-survey-slice-design.md.

create type public.traveler_travel_vibe as enum ('heritage', 'food', 'nature', 'urban');

alter table public.traveler_profiles
  add column travel_vibe public.traveler_travel_vibe,
  add column budget_lean public.budget_tier,
  add column onboarding_completed_at timestamptz,
  add column profile_revision bigint not null default 1 check (profile_revision >= 1);

-- A completed profile must carry the fields every downstream ranking path assumes: a
-- budget lean and an on-grid serendipity dial. Direct table writes (the columns are
-- separately grantable) cannot mark a profile complete without them.
alter table public.traveler_profiles add constraint traveler_profiles_completed_shape check (
  onboarding_completed_at is null
  or (budget_lean is not null and serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3))
);

-- Close the (trip_member_id, trip_id) invariant gap structurally: the 202609050006 UPDATE
-- policy checks membership but not that the member belongs to trip_id (the INSERT policy does).
alter table public.trip_members add constraint trip_members_trip_id_id_key unique (trip_id, id);
alter table public.traveler_profiles
  add constraint traveler_profiles_member_in_trip_fk
  foreign key (trip_id, trip_member_id) references public.trip_members (trip_id, id) on delete cascade;

-- profile_revision is server-managed: forced to 1 on insert, +1 on every update, regardless
-- of any client-supplied value.
create function public.traveler_profiles_set_initial_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.profile_revision := 1;
  return new;
end;
$$;
create trigger traveler_profiles_set_initial_revision
  before insert on public.traveler_profiles
  for each row execute function public.traveler_profiles_set_initial_revision();

create function public.traveler_profiles_bump_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.profile_revision := old.profile_revision + 1;
  return new;
end;
$$;
create trigger traveler_profiles_bump_revision
  before update on public.traveler_profiles
  for each row execute function public.traveler_profiles_bump_revision();

-- Column-scoped writes: id / created_at / updated_at / profile_revision are never
-- client-writable. Replaces the table-wide grant from 202609050006.
revoke insert, update on public.traveler_profiles from authenticated;
grant insert (
  trip_id, trip_member_id, interest_vector, budget_daily_cap, budget_total_cap, pace,
  mobility_threshold_m, serendipity_epsilon, social_role,
  travel_vibe, budget_lean, onboarding_completed_at
) on public.traveler_profiles to authenticated;
grant update (
  interest_vector, budget_daily_cap, budget_total_cap, pace, mobility_threshold_m,
  serendipity_epsilon, social_role, travel_vibe, budget_lean, onboarding_completed_at
) on public.traveler_profiles to authenticated;

-- Recreate the UPDATE policy with the membership-pair check in WITH CHECK, matching the
-- INSERT policy. The composite FK above is the load-bearing guarantee; this is parity.
drop policy "members or managers update traveler profiles" on public.traveler_profiles;
create policy "members or managers update traveler profiles" on public.traveler_profiles
for update to authenticated using (
  exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
  or public.can_manage_trip(trip_id)
) with check (
  exists (
    select 1 from public.trip_members tm
    where tm.id = trip_member_id and tm.trip_id = traveler_profiles.trip_id
  )
  and (
    exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
    or public.can_manage_trip(trip_id)
  )
);

-- submit_onboarding RPC follows in Task 3 of the plan (same file).
```

- [ ] **Step 4: Run the test, verify the schema cases pass**

Run: `npx vitest run tests/database/onboarding-rls.test.ts`
Expected: PASS for the `202609060001 schema` describe block. (The `submit` helper cases do not exist yet.)

- [ ] **Step 5: Run the full DB suite to catch regressions**

Run: `npx vitest run tests/database/`
Expected: PASS. `constraints-rls.test.ts` and `migrations.test.ts` still green — the new columns are nullable, the CHECK's null branch covers their existing inserts, and the composite FK is satisfied by their genuine (trip, member) pairs.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202609060001_onboarding_profile.sql tests/database/onboarding-rls.test.ts
git commit -m "feat(onboarding): traveler_profiles schema, triggers, FK, grants, completed CHECK"
```

---

## Task 3: `submit_onboarding` RPC

**Files:**
- Modify: `supabase/migrations/202609060001_onboarding_profile.sql` (append the function)
- Modify: `tests/database/onboarding-rls.test.ts` (append RPC describe blocks)

**Interfaces:**
- Consumes: everything from Task 2, plus `public.trip_constraints` (+ its `trip_constraints_bump_revision` trigger), `public.trip_constraint_kind`, `public.trip_constraint_severity`.
- Produces: `public.submit_onboarding(p_trip_id uuid, p_expected_revision bigint, p_answers jsonb) returns bigint` — returns the new `profile_revision`; raises SQLSTATE `42501` (not a member), `40001` (stale revision / lost create race), `22023` (invalid input), `P0001` message `PENDING_CONSTRAINT_CONFLICT` (an unconfirmed constraint row blocks the add). `p_answers` keys are camelCase (`budgetLean`, `walkingCapM`, `surpriseDial`, `socialRole`, `dealbreakers.religiousAccess`).

- [ ] **Step 1: Write the failing tests (append to `tests/database/onboarding-rls.test.ts`)**

```ts
describe("submit_onboarding happy paths", () => {
  it("creates a profile + confirmed constraints and returns revision 1", async () => {
    const res = await submit(full({ dealbreakers: { dietary: ["halal", "no_peanut"], religiousAccess: ["prayer_space_needed"], mobility: [] } }));
    expect(res.rows[0].submit_onboarding).toBe("1");
    await actor(null, "postgres");
    const profile = (await db.query<{ travel_vibe: string; budget_lean: string; pace: string; social_role: string; serendipity_epsilon: string; mobility_threshold_m: number; onboarding_completed_at: string }>(
      "select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(profile).toMatchObject({ travel_vibe: "food", budget_lean: "standard", pace: "active", social_role: "gourmand", mobility_threshold_m: 2000 });
    expect(profile.serendipity_epsilon).toBe("0.150");
    expect(profile.onboarding_completed_at).not.toBeNull();
    const flags = (await db.query<{ kind: string; flag: string; severity: string; confirmed_at: string | null; confirmed_by: string }>(
      "select kind, flag, severity, confirmed_at, confirmed_by from trip_constraints where trip_member_id=$1 order by flag", [memberMemberId])).rows;
    expect(flags).toEqual([
      { kind: "dietary", flag: "halal", severity: "standard", confirmed_at: expect.any(String), confirmed_by: memberMemberId },
      { kind: "dietary", flag: "no_peanut", severity: "severe", confirmed_at: expect.any(String), confirmed_by: memberMemberId },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard", confirmed_at: expect.any(String), confirmed_by: memberMemberId },
    ]);
  });

  it("writes 0.15 for a first quick submit and leaves the full-only fields default", async () => {
    const res = await submit(quick({ budgetLean: "budget", walkingCapM: 1000 }));
    expect(res.rows[0].submit_onboarding).toBe("1");
    await actor(null, "postgres");
    const p = (await db.query<{ serendipity_epsilon: string; pace: string; travel_vibe: string | null; social_role: string | null; budget_lean: string; mobility_threshold_m: number }>(
      "select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(p.serendipity_epsilon).toBe("0.150");
    expect(p.pace).toBe("balanced");
    expect(p.travel_vibe).toBeNull();
    expect(p.social_role).toBeNull();
    expect(p.budget_lean).toBe("budget");
    expect(p.mobility_threshold_m).toBe(1000);
  });

  it("preserves epsilon/vibe/pace/role on a quick redo of a completed profile", async () => {
    await submit(full({ surpriseDial: 5, vibe: "nature", pace: "relaxed", socialRole: "navigator" })); // rev -> 1
    const res = await submit(quick({ budgetLean: "luxury" }), 1);                                       // rev -> 2
    expect(res.rows[0].submit_onboarding).toBe("2");
    await actor(null, "postgres");
    const p = (await db.query<{ serendipity_epsilon: string; travel_vibe: string; pace: string; social_role: string; budget_lean: string }>(
      "select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(p.serendipity_epsilon).toBe("0.300");
    expect(p).toMatchObject({ travel_vibe: "nature", pace: "relaxed", social_role: "navigator", budget_lean: "luxury" });
  });

  it("stores the plan's default severity for every supported flag", async () => {
    for (const flag of DIETARY_FLAGS) {
      await db.exec("select set_config('request.jwt.claim.sub', $1, false)".replace("$1", `'${member}'`)).catch(() => {});
      await actor(null, "postgres");
      await db.query("delete from trip_constraints where trip_member_id=$1", [memberMemberId]);
      await db.query("delete from traveler_profiles where trip_member_id=$1", [memberMemberId]);
      await submit(full({ dealbreakers: { dietary: [flag], religiousAccess: [], mobility: [] } }));
      await actor(null, "postgres");
      const row = (await db.query<{ severity: string }>(
        "select severity from trip_constraints where trip_member_id=$1 and flag=$2", [memberMemberId, flag])).rows[0];
      expect(row.severity).toBe(defaultSeverity(flag));
    }
    for (const flag of RELIGIOUS_ACCESS_FLAGS) {
      await actor(null, "postgres");
      await db.query("delete from trip_constraints where trip_member_id=$1", [memberMemberId]);
      await db.query("delete from traveler_profiles where trip_member_id=$1", [memberMemberId]);
      await submit(full({ dealbreakers: { dietary: [], religiousAccess: [flag], mobility: [] } }));
      await actor(null, "postgres");
      const row = (await db.query<{ severity: string }>(
        "select severity from trip_constraints where trip_member_id=$1 and flag=$2 and kind='religious_access'", [memberMemberId, flag])).rows[0];
      expect(row.severity).toBe(defaultReligiousAccessSeverity(flag));
    }
    for (const flag of MOBILITY_FLAGS) {
      await actor(null, "postgres");
      await db.query("delete from trip_constraints where trip_member_id=$1", [memberMemberId]);
      await db.query("delete from traveler_profiles where trip_member_id=$1", [memberMemberId]);
      await submit(full({ dealbreakers: { dietary: [], religiousAccess: [], mobility: [flag] } }));
      await actor(null, "postgres");
      const row = (await db.query<{ severity: string }>(
        "select severity from trip_constraints where trip_member_id=$1 and flag=$2 and kind='mobility'", [memberMemberId, flag])).rows[0];
      expect(row.severity).toBe(defaultMobilitySeverity(flag));
    }
  });
});

describe("submit_onboarding failure modes", () => {
  it("raises 42501 for a non-member", async () => {
    await db.query("insert into auth.users(id) values ($1)", [stranger]).catch(() => {});
    await expect(submit(quick(), 0, stranger)).rejects.toMatchObject({ code: "42501" });
  });

  it("raises 40001 on a stale expected revision and rolls back the constraint writes", async () => {
    await submit(full()); // rev -> 1
    await expect(submit(full({ dealbreakers: { dietary: ["vegan"], religiousAccess: [], mobility: [] } }), 0))
      .rejects.toMatchObject({ code: "40001" });
    await actor(null, "postgres");
    expect((await db.query("select 1 from trip_constraints where trip_member_id=$1 and flag='vegan'", [memberMemberId])).rows).toHaveLength(0);
  });

  it("raises 40001 when no row exists but a non-zero revision was supplied", async () => {
    await expect(submit(quick(), 7)).rejects.toMatchObject({ code: "40001" });
  });

  it("raises P0001 PENDING_CONSTRAINT_CONFLICT when an unconfirmed row blocks the add", async () => {
    await actor(null, "postgres");
    await db.query(`insert into trip_constraints(trip_id,trip_member_id,kind,flag) values ($1,$2,'dietary','vegan')`, [trip, memberMemberId]);
    await expect(submit(quick({ dealbreakers: { dietary: ["vegan"], religiousAccess: [], mobility: [] } })))
      .rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("PENDING_CONSTRAINT_CONFLICT") });
  });

  it("re-confirming an already-confirmed flag is a no-op, not a conflict", async () => {
    await submit(quick({ dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] } }));   // rev -> 1
    await expect(submit(quick({ dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] } }), 1)).resolves.toBeDefined();
  });
});

describe("submit_onboarding input validation (independent of Zod)", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["unknown mode", { ...quick(), mode: "bogus" }],
    ["missing budgetLean", (() => { const q = quick() as Record<string, unknown>; delete q.budgetLean; return q; })()],
    ["dealbreakers not an object", { ...quick(), dealbreakers: "halal" }],
    ["dietary not an array", { ...quick(), dealbreakers: { dietary: "halal", religiousAccess: [], mobility: [] } }],
    ["dietary over vocabulary length", { ...quick(), dealbreakers: { dietary: Array(20).fill("halal"), religiousAccess: [], mobility: [] } }],
    ["unknown dietary flag", { ...quick(), dealbreakers: { dietary: ["mystery"], religiousAccess: [], mobility: [] } }],
    ["walkingCapM negative", { ...quick(), walkingCapM: -5 }],
    ["walkingCapM too large", { ...quick(), walkingCapM: 999999 }],
    ["walkingCapM not a number", { ...quick(), walkingCapM: "far" }],
    ["invalid budgetLean enum", { ...quick(), budgetLean: "cheap" }],
    ["full: invalid vibe", { ...full(), vibe: "space" }],
    ["full: invalid pace", { ...full(), pace: "sprint" }],
    ["full: invalid socialRole", { ...full(), socialRole: "captain" }],
    ["full: surpriseDial out of range", { ...full(), surpriseDial: 9 }],
  ];
  for (const [name, answers] of bad) {
    it(`raises 22023 for ${name} and writes nothing`, async () => {
      await expect(submit(answers)).rejects.toMatchObject({ code: "22023" });
      await actor(null, "postgres");
      expect((await db.query("select 1 from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows).toHaveLength(0);
      expect((await db.query("select 1 from trip_constraints where trip_member_id=$1", [memberMemberId])).rows).toHaveLength(0);
    });
  }
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run tests/database/onboarding-rls.test.ts`
Expected: FAIL — `function public.submit_onboarding(...) does not exist`.

- [ ] **Step 3: Append the RPC to the migration**

Append to `supabase/migrations/202609060001_onboarding_profile.sql`:

```sql
-- One transaction: validate, apply add-only dealbreaker constraints, upsert the profile
-- (completion marker last). Any raise rolls the whole thing back, including the
-- trips.revision bumps fired by trip_constraints_bump_revision.
create function public.submit_onboarding(
  p_trip_id uuid,
  p_expected_revision bigint,
  p_answers jsonb
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_mode text := p_answers->>'mode';
  v_existing_revision bigint;
  v_prev_completed_at timestamptz;
  v_new_revision bigint;
  v_now timestamptz := now();
  v_cap int;
  v_epsilon numeric;
  v_kind text;
  v_flag text;
  v_severity public.trip_constraint_severity;
  v_row_count int;
  v_dietary text[] := array['halal','vegetarian','vegan','no_seafood','no_shellfish','no_pork','no_beef','no_dairy','no_gluten','no_peanut','other'];
  v_religious text[] := array['modest_dress_required','prayer_space_needed','no_alcohol_venues','other'];
  v_mobility text[] := array['wheelchair_accessible_required','limited_walking_distance','no_stairs','other'];
begin
  -- 1. Membership: the caller's own row on this trip.
  select tm.id into v_member_id
  from public.trip_members tm
  where tm.trip_id = p_trip_id and tm.user_id = auth.uid();
  if v_member_id is null then
    raise exception 'not a trip member' using errcode = '42501';
  end if;

  -- 2. Shape / input validation (the RPC is directly callable; Zod is not its only guard).
  if v_mode is null or v_mode not in ('quick', 'full') then
    raise exception 'invalid onboarding mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_answers->'dealbreakers') is distinct from 'object' then
    raise exception 'dealbreakers must be an object' using errcode = '22023';
  end if;
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'dietary', v_dietary);
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'religiousAccess', v_religious);
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'mobility', v_mobility);

  if jsonb_typeof(p_answers->'walkingCapM') not in ('number', 'null') or (p_answers ? 'walkingCapM') is false then
    raise exception 'walkingCapM must be a number or null' using errcode = '22023';
  end if;
  if jsonb_typeof(p_answers->'walkingCapM') = 'number' then
    v_cap := (p_answers->>'walkingCapM')::int;
    if v_cap < 0 or v_cap > 50000 then
      raise exception 'walkingCapM out of range' using errcode = '22023';
    end if;
  else
    v_cap := null;
  end if;

  if (p_answers->>'budgetLean') is null or (p_answers->>'budgetLean') not in ('budget','standard','premium','luxury') then
    raise exception 'invalid budgetLean' using errcode = '22023';
  end if;

  if v_mode = 'full' then
    if (p_answers->>'vibe') not in ('heritage','food','nature','urban') then
      raise exception 'invalid vibe' using errcode = '22023';
    end if;
    if (p_answers->>'pace') not in ('relaxed','balanced','active','intense') then
      raise exception 'invalid pace' using errcode = '22023';
    end if;
    if (p_answers->>'socialRole') not in ('navigator','chronicler','gourmand','go_with_the_flow','negotiator') then
      raise exception 'invalid socialRole' using errcode = '22023';
    end if;
    if jsonb_typeof(p_answers->'surpriseDial') is distinct from 'number'
       or (p_answers->>'surpriseDial')::numeric <> trunc((p_answers->>'surpriseDial')::numeric)
       or (p_answers->>'surpriseDial')::int < 1 or (p_answers->>'surpriseDial')::int > 5 then
      raise exception 'invalid surpriseDial' using errcode = '22023';
    end if;
  end if;

  -- 3. CAS precheck.
  select profile_revision, onboarding_completed_at
    into v_existing_revision, v_prev_completed_at
  from public.traveler_profiles
  where trip_member_id = v_member_id;

  if v_existing_revision is not null and v_existing_revision <> p_expected_revision then
    raise exception 'stale profile revision' using errcode = '40001';
  end if;
  if v_existing_revision is null and p_expected_revision <> 0 then
    raise exception 'stale profile revision' using errcode = '40001';
  end if;

  -- 4. Dealbreakers -- add-only.
  for v_kind, v_flag in
    select 'dietary', jsonb_array_elements_text(coalesce(p_answers->'dealbreakers'->'dietary', '[]'::jsonb))
    union all
    select 'religious_access', jsonb_array_elements_text(coalesce(p_answers->'dealbreakers'->'religiousAccess', '[]'::jsonb))
    union all
    select 'mobility', jsonb_array_elements_text(coalesce(p_answers->'dealbreakers'->'mobility', '[]'::jsonb))
  loop
    v_severity := case
      when v_kind = 'dietary' and v_flag in ('no_peanut', 'no_shellfish') then 'severe'
      when v_kind = 'mobility' and v_flag = 'wheelchair_accessible_required' then 'severe'
      else 'standard'
    end::public.trip_constraint_severity;

    insert into public.trip_constraints
      (trip_id, trip_member_id, kind, flag, severity, source, confirmed_by, confirmed_at)
    values
      (p_trip_id, v_member_id, v_kind::public.trip_constraint_kind, v_flag, v_severity, 'manual', v_member_id, v_now)
    on conflict (trip_member_id, kind, flag) do nothing;

    get diagnostics v_row_count = row_count;
    if v_row_count = 0 then
      perform 1 from public.trip_constraints
      where trip_member_id = v_member_id
        and kind = v_kind::public.trip_constraint_kind
        and flag = v_flag
        and confirmed_at is not null;
      if not found then
        raise exception 'PENDING_CONSTRAINT_CONFLICT' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- 5. Profile last.
  if v_mode = 'full' then
    v_epsilon := round((((p_answers->>'surpriseDial')::int - 1) / 4.0) * 0.3, 3);
  end if;

  if v_existing_revision is null then
    insert into public.traveler_profiles
      (trip_id, trip_member_id, budget_lean, mobility_threshold_m, onboarding_completed_at,
       travel_vibe, pace, social_role, serendipity_epsilon)
    values (
      p_trip_id, v_member_id,
      (p_answers->>'budgetLean')::public.budget_tier,
      v_cap,
      v_now,
      case when v_mode = 'full' then (p_answers->>'vibe')::public.traveler_travel_vibe end,
      case when v_mode = 'full' then (p_answers->>'pace')::public.pace_level else 'balanced'::public.pace_level end,
      case when v_mode = 'full' then (p_answers->>'socialRole')::public.traveler_social_role end,
      case when v_mode = 'full' then v_epsilon else 0.15 end
    )
    on conflict (trip_member_id) do nothing
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  elsif v_mode = 'full' then
    update public.traveler_profiles set
      budget_lean = (p_answers->>'budgetLean')::public.budget_tier,
      mobility_threshold_m = v_cap,
      onboarding_completed_at = v_now,
      travel_vibe = (p_answers->>'vibe')::public.traveler_travel_vibe,
      pace = (p_answers->>'pace')::public.pace_level,
      social_role = (p_answers->>'socialRole')::public.traveler_social_role,
      serendipity_epsilon = v_epsilon
    where trip_member_id = v_member_id and profile_revision = p_expected_revision
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  else
    update public.traveler_profiles set
      budget_lean = (p_answers->>'budgetLean')::public.budget_tier,
      mobility_threshold_m = v_cap,
      onboarding_completed_at = v_now,
      serendipity_epsilon = case when v_prev_completed_at is null then 0.15
                                 else public.traveler_profiles.serendipity_epsilon end
    where trip_member_id = v_member_id and profile_revision = p_expected_revision
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  end if;

  return v_new_revision;
end;
$$;

-- Pure validator; raises 22023 on any malformed flag list. Granted to authenticated so the
-- security-invoker RPC (which runs as the caller) can call it. It touches no table.
create function public._onboarding_check_flags(p_value jsonb, p_vocab text[])
returns void language plpgsql immutable set search_path = '' as $$
declare v_el text;
begin
  if p_value is null then return; end if;
  if jsonb_typeof(p_value) <> 'array' then
    raise exception 'dealbreaker list must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_value) > array_length(p_vocab, 1) then
    raise exception 'dealbreaker list too long' using errcode = '22023';
  end if;
  for v_el in select jsonb_array_elements_text(p_value) loop
    if not (v_el = any (p_vocab)) then
      raise exception 'unknown dealbreaker flag' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public._onboarding_check_flags(jsonb, text[]) from public, anon;
grant execute on function public._onboarding_check_flags(jsonb, text[]) to authenticated;
revoke all on function public.submit_onboarding(uuid, bigint, jsonb) from public, anon;
grant execute on function public.submit_onboarding(uuid, bigint, jsonb) to authenticated;
```

Define `_onboarding_check_flags` **before** `submit_onboarding` in the file (Postgres resolves function calls at runtime, so order does not strictly matter, but keep the helper first for readability).

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run tests/database/onboarding-rls.test.ts`
Expected: PASS for all `submit_onboarding` describe blocks. If `serendipity_epsilon` assertions fail on formatting, note PGlite returns `numeric` as a string with the stored scale (`"0.150"`, `"0.300"`); assert those exact strings (already done above), or compare `Number(value)`.

- [ ] **Step 5: Full DB + domain suites**

Run: `npx vitest run tests/database/ tests/domain/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202609060001_onboarding_profile.sql tests/database/onboarding-rls.test.ts
git commit -m "feat(onboarding): transactional submit_onboarding RPC"
```

---

## Task 4: Server actions

**Files:**
- Create: `app/actions/onboarding.ts`
- (Tested via Task 5's route tests — server actions need a Supabase client and are exercised through the route, matching the repo's pattern for `constraints.ts`.)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `verifiedUser` from `@/lib/supabase/auth`; `AppError`, `databaseError` from `@/lib/http/errors`; `submitBodySchema`, `OnboardingSnapshot` from `@/lib/domain/onboarding`; `DIETARY_FLAGS`/`RELIGIOUS_ACCESS_FLAGS`/`MOBILITY_FLAGS` from `@/lib/domain/constraints`.
- Produces:
  - `getMyOnboarding(tripId: string): Promise<OnboardingSnapshot>`
  - `getOnboardingNeeded(tripId: string): Promise<boolean>`
  - `submitOnboarding(tripId: string, rawBody: unknown): Promise<{ profileRevision: number; needsOnboarding: false }>`

- [ ] **Step 1: Implement `app/actions/onboarding.ts`**

```ts
"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { submitBodySchema, type OnboardingSnapshot } from "@/lib/domain/onboarding";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
} from "@/lib/domain/constraints";

const tripIdSchema = z.string().uuid();

async function myMembership(client: Awaited<ReturnType<typeof createClient>>, tripId: string) {
  const user = await verifiedUser(client);
  const { data, error } = await client
    .from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  return data.id as string;
}

const KINDS = ["dietary", "religious_access", "mobility"] as const;
const FLAG_SCHEMA = {
  dietary: dietaryFlagSchema,
  religious_access: religiousAccessFlagSchema,
  mobility: mobilityFlagSchema,
} as const;

export async function getMyOnboarding(tripId: string): Promise<OnboardingSnapshot> {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  const memberId = await myMembership(client, tripId);

  const [{ data: profileRow, error: profileError }, { data: constraintRows, error: constraintError }] = await Promise.all([
    client.from("traveler_profiles")
      .select("travel_vibe,budget_lean,pace,social_role,serendipity_epsilon,mobility_threshold_m,onboarding_completed_at,profile_revision")
      .eq("trip_id", tripId).eq("trip_member_id", memberId).maybeSingle(),
    client.from("trip_constraints")
      .select("kind,flag,confirmed_at")
      .eq("trip_id", tripId).eq("trip_member_id", memberId).in("kind", [...KINDS]),
  ]);
  if (profileError) databaseError(profileError);
  if (constraintError) databaseError(constraintError);

  const dealbreakers = {
    dietary: { confirmed: [] as string[], pending: [] as string[] },
    religiousAccess: { confirmed: [] as string[], pending: [] as string[] },
    mobility: { confirmed: [] as string[], pending: [] as string[] },
  };
  const bucket = { dietary: "dietary", religious_access: "religiousAccess", mobility: "mobility" } as const;
  for (const row of constraintRows ?? []) {
    const kind = row.kind as (typeof KINDS)[number];
    const parsed = FLAG_SCHEMA[kind].safeParse(row.flag);
    if (!parsed.success) continue; // ignore an unknown flag rather than crash the wizard
    dealbreakers[bucket[kind]][row.confirmed_at ? "confirmed" : "pending"].push(parsed.data);
  }

  const profile = profileRow
    ? {
        travelVibe: profileRow.travel_vibe,
        budgetLean: profileRow.budget_lean,
        pace: profileRow.pace,
        socialRole: profileRow.social_role,
        serendipityEpsilon: Number(profileRow.serendipity_epsilon),
        mobilityThresholdM: profileRow.mobility_threshold_m,
        onboardingCompletedAt: profileRow.onboarding_completed_at,
      }
    : null;

  return {
    profile,
    profileRevision: profileRow ? Number(profileRow.profile_revision) : 0,
    dealbreakers: dealbreakers as OnboardingSnapshot["dealbreakers"],
    needsOnboarding: profile?.onboardingCompletedAt == null,
  };
}

export async function getOnboardingNeeded(tripId: string): Promise<boolean> {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  await verifiedUser(client);
  const { data, error } = await client
    .from("traveler_profiles").select("onboarding_completed_at").eq("trip_id", tripId).maybeSingle();
  if (error) databaseError(error);
  return !data || data.onboarding_completed_at == null;
}

function mapRpcError(error: { code?: string; message?: string }): AppError {
  if (error.code === "42501") return new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  if (error.code === "40001") {
    return new AppError(409, "Your preferences changed in another session. Reload to see the latest.", "STALE_PROFILE");
  }
  if (error.code === "P0001" && (error.message ?? "").includes("PENDING_CONSTRAINT_CONFLICT")) {
    return new AppError(409, "A pending suggestion exists for one of these dealbreakers; resolve it in constraint review first.", "PENDING_CONSTRAINT");
  }
  if (error.code === "22023") {
    return new AppError(422, "Some of the survey answers were invalid. Please review and resubmit.", "INVALID_ONBOARDING");
  }
  try { databaseError(error); } catch (mapped) { return mapped as AppError; }
  return new AppError(503, "Onboarding is temporarily unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export async function submitOnboarding(tripId: string, rawBody: unknown) {
  tripIdSchema.parse(tripId);
  const { expectedRevision, answers } = submitBodySchema.parse(rawBody);
  const client = await createClient();
  await verifiedUser(client);
  const { data, error } = await client.rpc("submit_onboarding", {
    p_trip_id: tripId,
    p_expected_revision: expectedRevision,
    p_answers: answers,
  });
  if (error) throw mapRpcError(error);
  return { profileRevision: Number(data), needsOnboarding: false as const };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint app/actions/onboarding.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/actions/onboarding.ts
git commit -m "feat(onboarding): getMyOnboarding, getOnboardingNeeded, submitOnboarding actions"
```

---

## Task 5: API route

**Files:**
- Create: `app/api/trips/[tripId]/onboarding/route.ts`
- Test: `tests/api/onboarding.test.ts`

**Interfaces:**
- Consumes: `getMyOnboarding`, `submitOnboarding` from `@/app/actions/onboarding`; `errorResponse` from `@/lib/http/errors`; `readJson`, `requireSameOrigin` from `@/lib/http/request`.
- Produces: `GET` (→ `OnboardingSnapshot` JSON, `Cache-Control: private, no-store`) and `POST` (→ `{ profileRevision, needsOnboarding }`, status `200`).

- [ ] **Step 1: Write the failing test**

Create `tests/api/onboarding.test.ts` (pattern from `tests/api/routes.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({ getMyOnboarding: vi.fn(), submitOnboarding: vi.fn() }));
vi.mock("@/app/actions/onboarding", () => ({
  getMyOnboarding: mocks.getMyOnboarding,
  submitOnboarding: mocks.submitOnboarding,
}));

import { GET, POST } from "@/app/api/trips/[tripId]/onboarding/route";

const id = "12345678-1234-4123-8123-123456789012";
const context = { params: Promise.resolve({ tripId: id }) };
const post = (body?: unknown, origin = "https://trip.test") =>
  new Request(`https://trip.test/api/trips/${id}/onboarding`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const validBody = {
  expectedRevision: 0,
  answers: { mode: "quick", dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, walkingCapM: null, budgetLean: "standard" },
};

beforeEach(() => vi.resetAllMocks());

describe("onboarding route", () => {
  it("returns the caller's snapshot with a private cache header", async () => {
    mocks.getMyOnboarding.mockResolvedValue({ profile: null, profileRevision: 0, dealbreakers: {}, needsOnboarding: true });
    const response = await GET(new Request("https://trip.test"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).needsOnboarding).toBe(true);
  });

  it("accepts a valid same-origin submission", async () => {
    mocks.submitOnboarding.mockResolvedValue({ profileRevision: 1, needsOnboarding: false });
    const response = await POST(post(validBody), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profileRevision: 1, needsOnboarding: false });
    expect(mocks.submitOnboarding).toHaveBeenCalledWith(id, validBody);
  });

  it("blocks a cross-origin submission before calling the action", async () => {
    const response = await POST(post(validBody, "https://evil.test"), context);
    expect(response.status).toBe(403);
    expect(mocks.submitOnboarding).not.toHaveBeenCalled();
  });

  it("maps a stale-profile AppError to 409", async () => {
    mocks.submitOnboarding.mockRejectedValue(new AppError(409, "changed elsewhere", "STALE_PROFILE"));
    const response = await POST(post(validBody), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("STALE_PROFILE");
  });

  it("returns 422 for a malformed body", async () => {
    mocks.submitOnboarding.mockRejectedValue(new AppError(422, "bad", "INVALID_ONBOARDING"));
    const response = await POST(post({ nope: true }), context);
    expect(response.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/api/onboarding.test.ts`
Expected: FAIL — cannot import the route module.

- [ ] **Step 3: Implement `app/api/trips/[tripId]/onboarding/route.ts`**

```ts
import { z } from "zod";
import { getMyOnboarding, submitOnboarding } from "@/app/actions/onboarding";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Context) {
  try {
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const snapshot = await getMyOnboarding(tripId);
    return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const result = await submitOnboarding(tripId, await readJson(request));
    return Response.json(result, { status: 200 });
  } catch (error) { return errorResponse(error); }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/api/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/trips/[tripId]/onboarding/route.ts tests/api/onboarding.test.ts
git commit -m "feat(onboarding): GET/POST /api/trips/[tripId]/onboarding"
```

---

## Task 6: Wizard component + onboarding page

**Files:**
- Create: `components/onboarding-wizard.tsx`, `app/trips/[tripId]/onboarding/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/onboarding-wizard.test.tsx`

**Interfaces:**
- Consumes: `OnboardingSnapshot`, `TRAVEL_VIBES`, `TRAVEL_VIBE_LABELS`, `SOCIAL_ROLES`, `SOCIAL_ROLE_LABELS`, `WALKING_CAP_PRESETS`, `SURPRISE_DIAL_DEFAULT`, `epsilonToSurpriseDial` from `@/lib/domain/onboarding`; the three `*_FLAGS` + `*_FLAG_LABELS` from `@/lib/domain/constraints`; `budgetTiers`, `paceLevels` from `@/lib/domain/trip`; `useRouter` from `next/navigation`.
- Produces: `OnboardingWizard({ tripId, initial, successHref })`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/onboarding-wizard.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import type { OnboardingSnapshot } from "@/lib/domain/onboarding";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));

const emptySnapshot: OnboardingSnapshot = {
  profile: null,
  profileRevision: 0,
  dealbreakers: {
    dietary: { confirmed: [], pending: [] },
    religiousAccess: { confirmed: [], pending: [] },
    mobility: { confirmed: [], pending: [] },
  },
  needsOnboarding: true,
};

const fetchMock = vi.fn<typeof fetch>();
const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); replace.mockReset(); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function lastPostBody() {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("OnboardingWizard", () => {
  it("gates step 1 on a vibe choice in full mode", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Food & markets/ }));
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("walks all five steps and submits every answer", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ profileRevision: 1, needsOnboarding: false }));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);

    await user.click(screen.getByRole("radio", { name: /Heritage & history/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 2
    await user.click(screen.getByRole("button", { name: "Halal" }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 3
    await user.click(screen.getByRole("radio", { name: "Premium" }));
    await user.click(screen.getByRole("radio", { name: "Relaxed" }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 4
    await user.click(screen.getByRole("radio", { name: /Gourmand/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 5
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trips/t1/workspace"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/trips/t1/onboarding");
    expect(lastPostBody()).toEqual({
      expectedRevision: 0,
      answers: {
        mode: "full",
        dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] },
        walkingCapM: null,
        budgetLean: "premium",
        vibe: "heritage",
        pace: "relaxed",
        socialRole: "gourmand",
        surpriseDial: 3,
      },
    });
  });

  it("collapses to two screens in quick mode", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ profileRevision: 1, needsOnboarding: false }));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> budget screen
    await user.click(screen.getByRole("radio", { name: "Budget" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastPostBody().answers).toEqual({
      mode: "quick",
      dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
      walkingCapM: null,
      budgetLean: "budget",
    });
  });

  it("keeps entered answers when going Back", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("radio", { name: /Nature & outdoors/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("radio", { name: /Nature & outdoors/ })).toBeChecked();
  });

  it("locks an already-confirmed dealbreaker and points removal elsewhere", async () => {
    const user = userEvent.setup();
    const snapshot: OnboardingSnapshot = {
      ...emptySnapshot,
      dealbreakers: { ...emptySnapshot.dealbreakers, dietary: { confirmed: ["halal"], pending: [] } },
    };
    render(<OnboardingWizard tripId="t1" initial={snapshot} successHref="/x" />);
    await user.click(screen.getByRole("radio", { name: /Urban & nightlife/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    const chip = screen.getByRole("button", { name: "Halal" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a Reload affordance on a stale response and resends the refetched revision", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "changed elsewhere", code: "STALE_PROFILE" }, 409))
      .mockResolvedValueOnce(jsonResponse({ ...emptySnapshot, profileRevision: 4 }))
      .mockResolvedValueOnce(jsonResponse({ profileRevision: 5, needsOnboarding: false }));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const reload = await screen.findByRole("button", { name: "Reload" });
    await user.click(reload);
    // wizard reseeded to step 1; redo the quick flow
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastPostBody().expectedRevision).toBe(4);
  });

  it("surfaces a generic error and stays on the step", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope", code: "PENDING_CONSTRAINT" }, 409));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(replace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/components/onboarding-wizard.test.tsx`
Expected: FAIL — cannot import `@/components/onboarding-wizard`.

- [ ] **Step 3: Implement `components/onboarding-wizard.tsx`**

```tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIETARY_FLAGS, DIETARY_FLAG_LABELS,
  RELIGIOUS_ACCESS_FLAGS, RELIGIOUS_ACCESS_FLAG_LABELS,
  MOBILITY_FLAGS, MOBILITY_FLAG_LABELS,
} from "@/lib/domain/constraints";
import { budgetTiers, paceLevels } from "@/lib/domain/trip";
import {
  TRAVEL_VIBES, TRAVEL_VIBE_LABELS, SOCIAL_ROLES, SOCIAL_ROLE_LABELS,
  WALKING_CAP_PRESETS, SURPRISE_DIAL_DEFAULT, epsilonToSurpriseDial,
  type OnboardingSnapshot, type TravelVibe, type SocialRole,
} from "@/lib/domain/onboarding";
import type { BudgetTier, PaceLevel } from "@/lib/domain/trip";

type Draft = {
  vibe: TravelVibe | null;
  dietary: Set<string>;
  religiousAccess: Set<string>;
  mobility: Set<string>;
  walkingCapM: number | null;
  budgetLean: BudgetTier;
  pace: PaceLevel;
  socialRole: SocialRole | null;
  surpriseDial: number;
};

const SURPRISE_LABELS = ["stick to the plan", "mostly planned", "balanced", "mostly open", "surprise me"];
const STEP_TITLES: Record<number, string> = {
  1: "What's this trip about?",
  2: "Anything that must be respected?",
  3: "Energy and budget",
  4: "Your role in the group",
  5: "How much spontaneity?",
};

function draftFrom(snapshot: OnboardingSnapshot): Draft {
  const p = snapshot.profile;
  return {
    vibe: p?.travelVibe ?? null,
    dietary: new Set(snapshot.dealbreakers.dietary.confirmed),
    religiousAccess: new Set(snapshot.dealbreakers.religiousAccess.confirmed),
    mobility: new Set(snapshot.dealbreakers.mobility.confirmed),
    walkingCapM: p?.mobilityThresholdM ?? null,
    budgetLean: (p?.budgetLean ?? "standard") as BudgetTier,
    pace: (p?.pace ?? "balanced") as PaceLevel,
    socialRole: p?.socialRole ?? null,
    surpriseDial: p?.onboardingCompletedAt == null ? SURPRISE_DIAL_DEFAULT : epsilonToSurpriseDial(p.serendipityEpsilon),
  };
}

export function OnboardingWizard({ tripId, initial, successHref }: {
  tripId: string;
  initial: OnboardingSnapshot;
  successHref: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"full" | "quick">("full");
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [expectedRevision, setExpectedRevision] = useState(initial.profileRevision);
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const steps = mode === "quick" ? [2, 3] : [1, 2, 3, 4, 5];
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex >= steps.length - 1;

  useEffect(() => { headingRef.current?.focus(); }, [step, mode]);

  const canAdvance =
    mode === "quick" ? true
    : step === 1 ? draft.vibe !== null
    : step === 4 ? draft.socialRole !== null
    : true;

  function reseed(snapshot: OnboardingSnapshot) {
    setDraft(draftFrom(snapshot));
    setExpectedRevision(snapshot.profileRevision);
    setStepIndex(0);
    setError(null);
    setStale(false);
  }

  function toggleFlag(key: "dietary" | "religiousAccess" | "mobility", flag: string) {
    setDraft((current) => {
      const next = new Set(current[key]);
      next.has(flag) ? next.delete(flag) : next.add(flag);
      return { ...current, [key]: next };
    });
  }

  function buildAnswers() {
    const dealbreakers = {
      dietary: [...draft.dietary],
      religiousAccess: [...draft.religiousAccess],
      mobility: [...draft.mobility],
    };
    if (mode === "quick") {
      return { mode: "quick" as const, dealbreakers, walkingCapM: draft.walkingCapM, budgetLean: draft.budgetLean };
    }
    return {
      mode: "full" as const, dealbreakers, walkingCapM: draft.walkingCapM, budgetLean: draft.budgetLean,
      vibe: draft.vibe, pace: draft.pace, socialRole: draft.socialRole, surpriseDial: draft.surpriseDial,
    };
  }

  async function finish() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/onboarding`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision, answers: buildAnswers() }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) { router.replace(successHref); return; }
      if (data?.code === "STALE_PROFILE") { setStale(true); setError(data.error ?? "Your preferences changed elsewhere."); return; }
      setError(data?.error ?? `Could not save your answers (${response.status}).`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    setPending(true);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/onboarding`, { cache: "no-store" });
      const data = (await response.json()) as OnboardingSnapshot;
      if (response.ok) reseed(data);
      else setError("Reload failed. Refresh the page and try again.");
    } catch {
      setError("Reload failed. Refresh the page and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="onboarding" aria-labelledby="onboarding-heading">
      <p className="onboarding-progress">
        {mode === "quick" ? <span className="onboarding-badge">Quick</span> : null}
        Step {stepIndex + 1} of {steps.length}
      </p>
      <h2 id="onboarding-heading" ref={headingRef} tabIndex={-1}>{STEP_TITLES[step]}</h2>

      {step === 1 && (
        <fieldset className="onboarding-cards">
          <legend className="field-hint">Pick the one that fits best.</legend>
          {TRAVEL_VIBES.map((vibe) => (
            <label key={vibe} className="onboarding-card">
              <input type="radio" name="vibe" checked={draft.vibe === vibe}
                onChange={() => setDraft({ ...draft, vibe })} />
              <span>{TRAVEL_VIBE_LABELS[vibe]}</span>
            </label>
          ))}
          <label className="onboarding-quick">
            <input type="checkbox" checked={mode === "quick"}
              onChange={(event) => { setMode(event.target.checked ? "quick" : "full"); setStepIndex(0); }} />
            Quick mode — dealbreakers and budget only
          </label>
        </fieldset>
      )}

      {step === 2 && (
        <div className="onboarding-dealbreakers">
          <p className="field-hint">
            Tap anything that must be respected. You can add more later. Removing a dietary flag is done
            on the trip dashboard; religious-access and mobility flags become editable when constraint
            review ships.
          </p>
          <ChipGroup title="Dietary" flags={DIETARY_FLAGS} labels={DIETARY_FLAG_LABELS}
            selected={draft.dietary} existing={initial.dealbreakers.dietary}
            onToggle={(flag) => toggleFlag("dietary", flag)} />
          <ChipGroup title="Religious access" flags={RELIGIOUS_ACCESS_FLAGS} labels={RELIGIOUS_ACCESS_FLAG_LABELS}
            selected={draft.religiousAccess} existing={initial.dealbreakers.religiousAccess}
            onToggle={(flag) => toggleFlag("religiousAccess", flag)} />
          <ChipGroup title="Mobility" flags={MOBILITY_FLAGS} labels={MOBILITY_FLAG_LABELS}
            selected={draft.mobility} existing={initial.dealbreakers.mobility}
            onToggle={(flag) => toggleFlag("mobility", flag)} />
          <fieldset className="onboarding-walking">
            <legend>Comfortable walking distance between stops</legend>
            <div className="segmented">
              {WALKING_CAP_PRESETS.map((preset) => (
                <label key={String(preset.value)}>
                  <input type="radio" name="walkingCap" checked={draft.walkingCapM === preset.value}
                    onChange={() => setDraft({ ...draft, walkingCapM: preset.value })} />
                  <span>{preset.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {step === 3 && (
        <div className="onboarding-sliders">
          <fieldset>
            <legend>Budget lean</legend>
            <div className="segmented">
              {budgetTiers.map((tier) => (
                <label key={tier.value}>
                  <input type="radio" name="budgetLean" checked={draft.budgetLean === tier.value}
                    onChange={() => setDraft({ ...draft, budgetLean: tier.value })} />
                  <span>{tier.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "full" && (
            <fieldset>
              <legend>Daily pace</legend>
              <div className="segmented">
                {paceLevels.map((level) => (
                  <label key={level.value}>
                    <input type="radio" name="pace" checked={draft.pace === level.value}
                      onChange={() => setDraft({ ...draft, pace: level.value })} />
                    <span>{level.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {step === 4 && (
        <fieldset className="onboarding-roles">
          <legend className="field-hint">Only you can see this — it never appears to other members.</legend>
          {SOCIAL_ROLES.map((role) => (
            <label key={role} className="onboarding-role">
              <input type="radio" name="socialRole" checked={draft.socialRole === role}
                onChange={() => setDraft({ ...draft, socialRole: role })} />
              <span>{SOCIAL_ROLE_LABELS[role]}</span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 5 && (
        <div className="onboarding-dial">
          <label htmlFor="surprise-dial">Slide toward how you want this trip to feel.</label>
          <input id="surprise-dial" type="range" min={1} max={5} step={1} value={draft.surpriseDial}
            aria-valuetext={`${draft.surpriseDial} of 5 — ${SURPRISE_LABELS[draft.surpriseDial - 1]}`}
            onChange={(event) => setDraft({ ...draft, surpriseDial: Number(event.target.value) })} />
          <p aria-hidden="true">{draft.surpriseDial} of 5 — {SURPRISE_LABELS[draft.surpriseDial - 1]}</p>
        </div>
      )}

      {error && (
        <p className="error-notice" role="alert">
          <span>{error}</span>
          {stale && (
            <button type="button" className="secondary-button" disabled={pending} onClick={() => void reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <div className="onboarding-nav">
        <button type="button" className="secondary-button" disabled={pending || stepIndex === 0}
          onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>
          Back
        </button>
        {isLast ? (
          <button type="button" className="primary-button" disabled={pending || !canAdvance} onClick={() => void finish()}>
            Finish
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={pending || !canAdvance}
            onClick={() => setStepIndex((index) => index + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}

function ChipGroup({ title, flags, labels, selected, existing, onToggle }: {
  title: string;
  flags: readonly string[];
  labels: Record<string, string>;
  selected: Set<string>;
  existing: { confirmed: string[]; pending: string[] };
  onToggle: (flag: string) => void;
}) {
  return (
    <fieldset className="onboarding-chip-group">
      <legend>{title}</legend>
      <div className="flag-grid" role="group" aria-label={title}>
        {flags.map((flag) => {
          const confirmed = existing.confirmed.includes(flag);
          const pending = existing.pending.includes(flag);
          const locked = confirmed || pending;
          return (
            <button key={flag} type="button" className="flag-chip"
              aria-pressed={confirmed || selected.has(flag)}
              disabled={locked}
              title={confirmed ? "Already set — manage it on the trip dashboard"
                : pending ? "Suggested — review coming soon" : undefined}
              onClick={() => onToggle(flag)}>
              {labels[flag]}{pending ? " (suggested)" : ""}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the wizard test, verify it passes**

Run: `npx vitest run tests/components/onboarding-wizard.test.tsx`
Expected: PASS. If a `getByRole("radio", { name: /Food & markets/ })` misses because the label text and input are siblings, wrap the `<span>` text inside the `<label>` (already done) — Testing Library associates an `<input>` with its wrapping `<label>`'s text.

- [ ] **Step 5: Add the `.onboarding-*` styles to `app/globals.css`**

Append (values chosen to match the existing token palette used elsewhere in the file):

```css
.onboarding { max-width: 560px; margin: 0 auto; padding: 24px 20px 32px; }
.onboarding-progress { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 12px; color: var(--muted); }
.onboarding-badge { padding: 2px 8px; border-radius: 999px; background: var(--teal-soft); color: var(--teal-dark); font-weight: 700; }
.onboarding h2 { margin: 0 0 16px; font-size: 18px; outline: none; }
.onboarding fieldset { border: 0; padding: 0; margin: 0 0 18px; min-width: 0; }
.onboarding legend { padding: 0; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
.onboarding-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.onboarding-card, .onboarding-role { display: flex; align-items: center; gap: 8px; padding: 12px; border: 1px solid var(--line-strong); border-radius: 8px; cursor: pointer; }
.onboarding-card:has(input:checked), .onboarding-role:has(input:checked) { border-color: var(--teal); background: var(--teal-soft); }
.onboarding-quick { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--muted); }
.onboarding-chip-group { margin-bottom: 14px; }
.onboarding-dial input[type="range"] { width: 100%; }
.onboarding-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; }
.travel-dna-nudge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.travel-dna-nudge > span { flex: 1; min-width: 0; }
```

- [ ] **Step 6: Implement `app/trips/[tripId]/onboarding/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { getMyOnboarding } from "@/app/actions/onboarding";
import { tripRepository } from "@/lib/repositories/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  let trip;
  try {
    trip = await (await tripRepository()).getTrip(tripId);
  } catch {
    notFound();
  }

  const snapshot = await getMyOnboarding(trip.id);

  return (
    <main className="app-shell">
      <div className="section-heading"><h1>Travel DNA — {trip.destinationName}</h1></div>
      <OnboardingWizard tripId={trip.id} initial={snapshot} successHref={`/trips/${trip.id}/workspace`} />
    </main>
  );
}
```

- [ ] **Step 7: Typecheck, lint, full component + api suites**

Run: `npx tsc --noEmit && npx eslint components/onboarding-wizard.tsx app/trips/[tripId]/onboarding/page.tsx && npx vitest run tests/components/ tests/api/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/onboarding-wizard.tsx "app/trips/[tripId]/onboarding/page.tsx" app/globals.css tests/components/onboarding-wizard.test.tsx
git commit -m "feat(onboarding): five-screen Travel DNA wizard + route"
```

---

## Task 7: Nudge banner + dashboard wiring

**Files:**
- Create: `components/travel-dna-nudge.tsx`
- Test: `tests/components/travel-dna-nudge.test.tsx`
- Modify: `app/api/trips/[tripId]/route.ts`, `components/trip-setup-dashboard.tsx`, `tests/api/routes.test.ts`, `tests/components/trip-setup-dashboard.test.tsx`

**Interfaces:**
- Consumes: `getOnboardingNeeded` from `@/app/actions/onboarding`.
- Produces: `TravelDnaNudge({ tripId })`; the `/api/trips/[tripId]` `GET` payload gains `needsOnboarding: boolean`; `TripDetail` in `trip-setup-dashboard.tsx` gains `needsOnboarding: boolean`.

- [ ] **Step 1: Write the failing banner test**

Create `tests/components/travel-dna-nudge.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TravelDnaNudge } from "@/components/travel-dna-nudge";

beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });
afterEach(() => cleanup());

describe("TravelDnaNudge", () => {
  it("links to the trip's onboarding route", () => {
    render(<TravelDnaNudge tripId="trip-9" />);
    expect(screen.getByRole("link", { name: /Start/ })).toHaveAttribute("href", "/trips/trip-9/onboarding");
  });

  it("dismisses for the browser session, per trip", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TravelDnaNudge tripId="trip-9" />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("travel-dna-nudge-dismissed:trip-9")).toBe("1");
    unmount();
    render(<TravelDnaNudge tripId="trip-9" />);
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
    render(<TravelDnaNudge tripId="trip-10" />);
    expect(screen.getByRole("link", { name: /Start/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/components/travel-dna-nudge.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `components/travel-dna-nudge.tsx`**

```tsx
"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

const storageKey = (tripId: string) => `travel-dna-nudge-dismissed:${tripId}`;

export function TravelDnaNudge({ tripId }: { tripId: string }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey(tripId)) === "1") setDismissed(true);
    } catch {
      // sessionStorage unavailable (private mode): fall back to dismissed-for-this-mount.
    }
  }, [tripId]);

  if (dismissed) return null;

  return (
    <div className="inline-notice travel-dna-nudge" role="status">
      <Sparkles aria-hidden="true" />
      <span>Complete your Travel DNA — about 60 seconds — for suggestions tuned to you.</span>
      <Link className="secondary-button" href={`/trips/${tripId}/onboarding`}>Start</Link>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => {
        try { sessionStorage.setItem(storageKey(tripId), "1"); } catch { /* ignore */ }
        setDismissed(true);
      }}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/components/travel-dna-nudge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `needsOnboarding` into the trip-detail route**

Modify `app/api/trips/[tripId]/route.ts`:
- Add import: `import { getOnboardingNeeded } from "@/app/actions/onboarding";`
- In `GET`, after `const dietaryFlags = await listMyDietaryConstraints(tripId);` add:
  `const needsOnboarding = await getOnboardingNeeded(tripId);`
- Change the response to include it:
  `return Response.json({ trip, proposals, dietaryFlags, members, selfMemberId, needsOnboarding }, { headers: { "Cache-Control": "private, no-store" } });`

- [ ] **Step 6: Update `tests/api/routes.test.ts` for the new field**

- Add to `vi.hoisted` mocks: `getOnboardingNeeded: vi.fn()`.
- Add mock: `vi.mock("@/app/actions/onboarding", () => ({ getOnboardingNeeded: mocks.getOnboardingNeeded }));`
- In the "returns trip and persisted proposals together" test: add `mocks.getOnboardingNeeded.mockResolvedValue(true);` and change the expected object to include `needsOnboarding: true`.

Run: `npx vitest run tests/api/routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Render the banner in the dashboard**

Modify `components/trip-setup-dashboard.tsx`:
- Import: `import { TravelDnaNudge } from "@/components/travel-dna-nudge";`
- `TripDetail` type: add `needsOnboarding: boolean;`.
- Add state: `const [needsOnboarding, setNeedsOnboarding] = useState(false);`
- In `initialize` (the `useEffect`): after `setDietaryFlags(detail?.dietaryFlags ?? []);` add `setNeedsOnboarding(detail?.needsOnboarding ?? false);`
- In `refreshDetail`: after `setDietaryFlags(detail.dietaryFlags);` add `setNeedsOnboarding(detail.needsOnboarding ?? false);`
- In `newTrip`: after `setDietaryFlags([]);` add `setNeedsOnboarding(false);`
- In the Setup `<section id="setup-panel" …>`, immediately before `{trip && <DietaryConstraintPicker …/>}`, add:
  `{trip && needsOnboarding && <TravelDnaNudge tripId={trip.id} />}`

- [ ] **Step 8: Extend `tests/components/trip-setup-dashboard.test.tsx`**

- In the `load()` helper, change the second mocked response to include the field:
  `.mockResolvedValueOnce(json({ trip: record, proposals, needsOnboarding: false }))`
- Add a test:

```tsx
it("shows the Travel DNA nudge only when onboarding is incomplete", async () => {
  fetchMock.mockResolvedValueOnce(json({ trips: [trip] }))
    .mockResolvedValueOnce(json({ trip, proposals: [], needsOnboarding: true }));
  render(<TripSetupDashboard email="owner@example.com" />);
  expect(await screen.findByRole("link", { name: /Start/ })).toHaveAttribute("href", `/trips/${trip.id}/onboarding`);
});
```

Run: `npx vitest run tests/components/trip-setup-dashboard.test.tsx`
Expected: PASS (existing tests still green — the banner is absent when `needsOnboarding` is false or omitted).

- [ ] **Step 9: Typecheck, lint, commit**

```bash
git add components/travel-dna-nudge.tsx tests/components/travel-dna-nudge.test.tsx "app/api/trips/[tripId]/route.ts" components/trip-setup-dashboard.tsx tests/api/routes.test.ts tests/components/trip-setup-dashboard.test.tsx
git commit -m "feat(onboarding): Travel DNA nudge on the trip dashboard"
```

---

## Task 8: Nudge on the workspace

**Files:**
- Modify: `app/trips/[tripId]/workspace/page.tsx`, `features/workspace/workspace-client.tsx`
- Test: `tests/components/workspace-client.test.tsx` (create)

**Interfaces:**
- Consumes: `getOnboardingNeeded`; `TravelDnaNudge`.
- Produces: `WorkspaceClient` gains a `needsOnboarding: boolean` prop.

- [ ] **Step 1: Write the failing test**

Create `tests/components/workspace-client.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceClient } from "@/features/workspace/workspace-client";

vi.mock("@/features/chat/chat-pane", () => ({ ChatPane: () => <div /> }));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ proposals: [], trip: {} }), { status: 200 }));
  try { sessionStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const base = {
  tripId: "trip-1", tripName: "KL", members: [], selfMemberId: null,
  canDecideProposals: false, initialActiveProposalId: null, mapSlot: <div />,
};

describe("WorkspaceClient onboarding nudge", () => {
  it("renders the nudge when onboarding is incomplete", async () => {
    render(<WorkspaceClient {...base} needsOnboarding />);
    expect(await screen.findByRole("link", { name: /Start/ })).toHaveAttribute("href", "/trips/trip-1/onboarding");
  });
  it("omits the nudge when onboarding is complete", async () => {
    render(<WorkspaceClient {...base} needsOnboarding={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/components/workspace-client.test.tsx`
Expected: FAIL — `needsOnboarding` is not a prop; no nudge rendered.

- [ ] **Step 3: Add the prop + banner to `features/workspace/workspace-client.tsx`**

- Add import: `import { TravelDnaNudge } from "@/components/travel-dna-nudge";`
- Add `needsOnboarding: boolean;` to the props type.
- Destructure `needsOnboarding` in the function signature.
- Change the returned JSX to a fragment:

```tsx
  return (
    <>
      {needsOnboarding && <TravelDnaNudge tripId={tripId} />}
      <WorkspaceShell tripName={tripName} members={members} blocks={[]}
        mapSlot={mapSlot}
        chatSlot={<ChatPane tripId={tripId} selfMemberId={selfMemberId} members={members}
          proposalsById={proposalsById} canDecideProposals={canDecideProposals}
          activeProposalId={activeProposalId} decidingProposalId={decidingProposalId} onDecision={handleDecision} />} />
    </>
  );
```

- [ ] **Step 4: Pass it from the server page**

Modify `app/trips/[tripId]/workspace/page.tsx`:
- Add import: `import { getOnboardingNeeded } from "@/app/actions/onboarding";`
- After `const memberRows = await listTripMembers(client, tripId);` add:
  `const needsOnboarding = await getOnboardingNeeded(trip.id);`
- Add `needsOnboarding={needsOnboarding}` to the `<WorkspaceClient …/>` props.

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run tests/components/workspace-client.test.tsx tests/components/workspace-shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
git add "app/trips/[tripId]/workspace/page.tsx" features/workspace/workspace-client.tsx tests/components/workspace-client.test.tsx
git commit -m "feat(onboarding): Travel DNA nudge on the workspace"
```

---

## Task 9: Status doc + full verification

**Files:**
- Modify: `docs/implementation-status.md`

- [ ] **Step 1: Update `docs/implementation-status.md`**

Replace the "Task 1.6 — ... : Not started" (or equivalent) subsection under "Phase 1" with:

```markdown
### Task 1.6 — Onboarding questionnaire (Travel DNA): Partial (slice 1 delivered)

Implemented 2026-09-06 (`docs/superpowers/specs/2026-09-06-onboarding-survey-slice-design.md`):

- `202609060001_onboarding_profile.sql`: `traveler_profiles` gains `travel_vibe`,
  `budget_lean`, `onboarding_completed_at`, and a server-managed `profile_revision`
  (BEFORE INSERT forces 1; BEFORE UPDATE bumps it and `updated_at`). A
  `traveler_profiles_completed_shape` CHECK requires a completed row to carry a
  `budget_lean` and an on-grid `serendipity_epsilon`. A composite
  `(trip_id, trip_member_id)` FK plus a recreated UPDATE policy close the
  202609050006 membership-pair gap. Column-scoped `insert`/`update` grants replace the
  table-wide grant. The `submit_onboarding(uuid, bigint, jsonb)` RPC (`security invoker`,
  one transaction) validates input independently of Zod, applies add-only dealbreaker
  constraints through the existing self-confirmed `trip_constraints` path, and upserts
  the profile with the completion marker last; SQLSTATEs `42501` / `40001` / `22023` /
  `P0001` map to `403` / `409 STALE_PROFILE` / `422` / `409 PENDING_CONSTRAINT`.
- `lib/domain/onboarding.ts`, `app/actions/onboarding.ts`
  (`getMyOnboarding` / `getOnboardingNeeded` / `submitOnboarding`),
  `app/api/trips/[tripId]/onboarding/route.ts`, `components/onboarding-wizard.tsx`
  (five screens + Quick mode, nav gating on vibe and social role, STALE_PROFILE reload),
  `app/trips/[tripId]/onboarding/page.tsx`, and a `components/travel-dna-nudge.tsx`
  banner shown on the dashboard and workspace while `onboarding_completed_at` is null
  (per-trip `sessionStorage` dismissal).
- Tests: `tests/domain/onboarding.test.ts`, `tests/database/onboarding-rls.test.ts`
  (schema, CHECK, grants, composite FK, and full RPC behavior incl. atomic rollback,
  RPC-side validation, and a per-flag severity-sync check against
  `lib/domain/constraints.ts`), `tests/components/onboarding-wizard.test.tsx`,
  `tests/components/travel-dna-nudge.test.tsx`, `tests/components/workspace-client.test.tsx`,
  `tests/api/onboarding.test.ts`.

Deliberately deferred: the always-available **My Travel Preferences** editor and its
route/API; the "Group Conductor" summary endpoint (needs a member-invite flow);
realtime requirements-changed announcements; the **Apply to future** /
**Review current itinerary** post-edit flow (needs Task 3.5's primitive);
`interest_vector` embedding (Task 1.3); and **removal / downgrade / supersession of a
confirmed dealbreaker** — this slice's Step 2 is add-only, and the wizard points
removals at the dashboard dietary picker (dietary) or a future constraint-review flow
(religious-access, mobility).
```

- [ ] **Step 2: Full verification**

Run each, expect all green:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If `npm run build` complains about the new dynamic route, confirm `export const dynamic = "force-dynamic";` is present in `app/trips/[tripId]/onboarding/page.tsx` (it is in Task 6 Step 6).

- [ ] **Step 3: Commit**

```bash
git add docs/implementation-status.md
git commit -m "docs(status): record Task 1.6 slice 1 (onboarding survey)"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
| --- | --- |
| §3.1 enum `traveler_travel_vibe` | Task 2 Step 3 |
| §3.2 four new columns | Task 2 Step 3; asserted Task 2 Step 1 |
| §3.3 concurrency triggers | Task 2 Step 3; asserted Task 2 Step 1 ("bumps profile_revision…") |
| §3.4 column-scoped grants (revoke then re-grant, both insert+update) | Task 2 Step 3; asserted Task 2 Step 1 ("rejects a client insert or update that names profile_revision or trip_id") |
| §3.5 composite FK + `unique (trip_id, id)` + recreated UPDATE policy | Task 2 Step 3; asserted Task 2 Step 1 ("composite FK") |
| §3.6 dial→epsilon grid; Quick writes 0.15 only when incomplete | Task 1 (`surpriseDialToEpsilon`); Task 3 (`v_epsilon` / `case … v_prev_completed_at`); asserted Task 1 + Task 3 ("writes 0.15 for a first quick submit", "preserves epsilon … on a quick redo") |
| §3.7 completed-profile CHECK | Task 2 Step 3; asserted Task 2 Step 1 ("enforces the completed-profile shape") |
| §3.8 no `trips.revision` bump from profile writes | Not separately asserted — the RPC never touches `trips`; the `trip_constraints` trigger is unchanged. |
| §4 RPC: membership, Zod-independent validation, CAS, add-only dealbreakers with pending-conflict, profile-last, atomic rollback | Task 3 (implementation + all `submit_onboarding` describe blocks) |
| §4 severity `case` mirrors `lib/domain/constraints.ts` | Task 3 Step 3 + "stores the plan's default severity for every supported flag" |
| §5 `getMyOnboarding` shape (profileRevision top-level only; confirmed/pending split) | Task 4 Step 1 |
| §5 `submitOnboarding` error map | Task 4 Step 1 (`mapRpcError`); asserted Task 5 ("maps a stale-profile AppError to 409") |
| §5 route: `dynamic`, `private, no-store`, `200`, same-origin | Task 5 |
| §6 wizard: props (no function props, `successHref`), draft defaults table, nav gating, screens, Reload=`reseed`, `router.replace` | Task 6 Step 3 + tests |
| §6 accessibility: focus to heading on step change, `role="alert"`, slider `aria-valuetext` + visible label | Task 6 Step 3 (`headingRef` effect, `.error-notice role="alert"`, `aria-valuetext`) |
| §6 icon-card visual deferral | Task 6 Step 3 (icon-free label cards; comment note) — recorded in `docs/implementation-status.md` Task 9 |
| §6 nudge: per-trip `sessionStorage`, mount-only fallback, shown while `needsOnboarding` | Task 7 (`travel-dna-nudge.tsx`) + Task 8 |
| §6 dashboard tracks `needsOnboarding` on load/switch/refresh/reset | Task 7 Step 7 |
| §7 tests | Tasks 1, 3, 5, 6, 7, 8 |
| §7 `docs/implementation-status.md` | Task 9 |
| §8 file list | matches "File Structure" above |

No gaps.

**2. Placeholder scan** — every code step carries full source. The one intentionally rough block (the `beforeEach` seed loop in Task 2 Step 1) is called out with a note telling the implementer to write the plain `for (const id of [tripOwner, member, otherMember, stranger])` loop. No "TBD", no "add error handling", no "similar to Task N".

**3. Type consistency**
- `OnboardingSnapshot` (Task 1) is consumed identically in Task 4 (return), Task 5 (test), Task 6 (`initial` prop, `draftFrom`).
- `submit_onboarding` param order `(p_trip_id, p_expected_revision, p_answers)` matches between Task 3 SQL, Task 3 test `submit()` helper, and Task 4 `client.rpc(...)`.
- The camelCase JSON keys (`budgetLean`, `walkingCapM`, `surpriseDial`, `socialRole`, `dealbreakers.religiousAccess`) are identical across the wizard's `buildAnswers` (Task 6), the Zod schema (Task 1), the RPC readers (Task 3), and every test fixture.
- Error codes `STALE_PROFILE` / `PENDING_CONSTRAINT` / `INVALID_ONBOARDING` / `FORBIDDEN` are used identically in `mapRpcError` (Task 4), the wizard's `data.code` check (Task 6), and the route test (Task 5).
- `getOnboardingNeeded` returns `boolean`, consumed as `needsOnboarding` in Task 7 (route + dashboard) and Task 8 (page + client).
- `epsilonToSurpriseDial` / `SURPRISE_DIAL_DEFAULT` defined in Task 1, used in Task 6 `draftFrom`.

No mismatches found.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-06-onboarding-survey.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

---

## Post-implementation review overrides

The plan above is retained as execution history. The implementation and approved design
were hardened after review; these decisions override stale embedded snippets in this plan:

- `epsilonToSurpriseDial` accepts only the five exact grid values; it does not choose the
  nearest value for `0.2` or another off-grid epsilon.
- The RPC rejects missing full-mode `vibe`, `pace`, and `socialRole` values explicitly as
  SQLSTATE `22023`.
- The RPC rejects fractional `walkingCapM` values before casting to `int`.
- Reload replaces the active confirmed/pending constraint snapshot as well as the draft
  and profile revision.
- Back on the first Quick screen returns to full-mode step 1.

RED/GREEN and final verification evidence is recorded in
`docs/testing/onboarding-review-fixes.tdd.md`.
