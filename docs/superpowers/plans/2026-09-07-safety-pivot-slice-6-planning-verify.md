# Slice 6 — global constraints in planning + verification (safety-first pivot)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, then
> superpowers:finishing-a-development-branch. Umbrella:
> `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`. Spec:
> `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md` §3.2, §6.

**Goal:** The hard-constraint gate evaluates the **union** of every participating member's
active global confirmed constraints and the trip's own active confirmed constraints —
through a narrow, non-attributable server projection — so a member's saved dietary /
religious-access / mobility requirements are enforced on every trip they join. Then update
the status doc and run the full verification sweep.

**Consumes (Slice 1):** `user_travel_constraints` (self-only RLS, active =
`retired_at is null and confirmed_at is not null`); `trip_constraint_kind` /
`trip_constraint_severity` enums.
**Consumes (existing):** `trip_constraints` + `confirmed_trip_constraints` (trip-scoped);
`SupabaseTripRepository.listConfirmedConstraints` → `ConfirmedConstraintFlag[]`
(`{ kind, flag, severity }`), consumed by `lib/domain/gemini-proposal-validation.ts`,
`app/api/trips/[tripId]/poi-choices/route.ts`, `lib/poi/schedule-validation.ts`,
`lib/services/trip-proposals.ts` — all of which pick up the union automatically.

**Not in this slice (nothing to wire into yet):** reweighting the global soft
`serendipity_epsilon` from current-trip prefs/expiring signals — the ε-greedy recommender
(Task 5.1) is not built. The projection function below is the contract it will read.
Social role is no longer a global field (dropped in `202609060004`), so there is nothing to
leak; the trip-scoped `traveler_profiles.social_role` is already behind narrow projections.

---

## Task 1 — `trip_enforced_constraints(uuid)` projection

**Files:** Create `supabase/migrations/202609060007_trip_enforced_constraints.sql`,
`tests/database/trip-enforced-constraints.test.ts`.

- [ ] **Step 1: Write `tests/database/trip-enforced-constraints.test.ts` (RED).** PGlite,
  same harness as `tests/database/chat-home-rpc.test.ts` (`AUTH_SETUP`, `loadMigration`,
  `actor`).

```ts
// harness identical to tests/database/chat-home-rpc.test.ts; users userA, userB, userC.
async function enforced(tripId: string, user: string) {
  await actor(user);
  return (await db.query("select * from public.trip_enforced_constraints($1::uuid)", [tripId])).rows as any[];
}

it("returns the union of the trip's confirmed constraints and every member's active global confirmed constraints", async () => {
  await actor(userA);
  const trip = (await db.query("select public.create_trip_group($1,$2,$3::date,$4::date,null,'balanced',null,false) as id",
    ["KL crew", "Kuala Lumpur", "2026-12-12", "2026-12-14"])).rows[0].id;
  // userA global: no_peanut (severe). userB global: halal. Plus a trip constraint: no_pork.
  await db.query("select public.submit_user_onboarding(0, $1::jsonb)",
    [JSON.stringify({ dealbreakers: { dietary: ["no_peanut"], religiousAccess: [], mobility: [] }, surpriseDial: null })]);
  await actor(userB);
  await db.query("select public.submit_user_onboarding(0, $1::jsonb)",
    [JSON.stringify({ dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] }, surpriseDial: null })]);
  await actor(null, "postgres");
  await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'B','member')", [trip, userB]);
  const memberA = (await db.query("select id from trip_members where trip_id=$1 and user_id=$2", [trip, userA])).rows[0].id;
  await db.query(
    "insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at) values ($1,$2,'dietary','no_pork','standard','manual',$2,now())",
    [trip, memberA]);

  const rows = await enforced(trip, userA);
  expect(rows.map((r) => `${r.flag}:${r.severity}`).sort()).toEqual(["halal:standard", "no_peanut:severe", "no_pork:standard"]);
  expect(Object.keys(rows[0])).toEqual(["kind", "flag", "severity"]); // no user_id, non-attributable
});

it("dedupes a (kind, flag) present in both scopes and keeps the strictest severity", async () => {
  await actor(userA);
  const trip = (await db.query("select public.create_trip_group($1,$2,$3::date,$4::date,null,'balanced',null,false) as id",
    ["t", "KL", "2026-12-12", "2026-12-14"])).rows[0].id;
  await db.query("select public.submit_user_onboarding(0, $1::jsonb)",
    [JSON.stringify({ dealbreakers: { dietary: ["no_shellfish"], religiousAccess: [], mobility: [] }, surpriseDial: null })]); // severe
  await actor(null, "postgres");
  const memberA = (await db.query("select id from trip_members where trip_id=$1 and user_id=$2", [trip, userA])).rows[0].id;
  await db.query(
    "insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at) values ($1,$2,'dietary','no_shellfish','standard','manual',$2,now())",
    [trip, memberA]);
  const rows = await enforced(trip, userA);
  expect(rows).toEqual([{ kind: "dietary", flag: "no_shellfish", severity: "severe" }]);
});

it("is trip-scoped: a member's global constraints do not leak into a trip they are not in, and non-members / anon are rejected", async () => {
  await actor(userC); // userC has a global constraint but joins nothing
  await db.query("select public.submit_user_onboarding(0, $1::jsonb)",
    [JSON.stringify({ dealbreakers: { dietary: ["vegan"], religiousAccess: [], mobility: [] }, surpriseDial: null })]);
  await actor(userA);
  const trip = (await db.query("select public.create_trip_group($1,$2,null,null,4,'relaxed',null,false) as id", ["t", "KL"])).rows[0].id;
  expect(await enforced(trip, userA)).toEqual([]);                 // no member has a confirmed constraint
  await expect(enforced(trip, userC)).rejects.toMatchObject({ code: "42501" });
  await actor(null, "anon");
  await expect(db.query("select * from public.trip_enforced_constraints($1::uuid)", [trip])).rejects.toMatchObject({ code: "42501" });
});

it("ignores retired or unconfirmed rows in both scopes", async () => {
  await actor(userA);
  const trip = (await db.query("select public.create_trip_group($1,$2,$3::date,$4::date,null,'balanced',null,false) as id",
    ["t", "KL", "2026-12-12", "2026-12-14"])).rows[0].id;
  await actor(null, "postgres");
  await db.query("insert into user_travel_constraints(user_id,kind,flag,created_by,confirmed_at,retired_at) values ($1,'dietary','halal',$1,now(),now())", [userA]);
  const memberA = (await db.query("select id from trip_members where trip_id=$1 and user_id=$2", [trip, userA])).rows[0].id;
  await db.query("insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source) values ($1,$2,'mobility','no_stairs','standard','manual')", [trip, memberA]); // unconfirmed
  expect(await enforced(trip, userA)).toEqual([]);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Write `202609060007_trip_enforced_constraints.sql`.**

```sql
-- The full hard-constraint set the Section VII gate evaluates for a trip (spec §3.2): the
-- UNION of every participating member's ACTIVE global confirmed constraints
-- (user_travel_constraints, retired_at is null and confirmed_at is not null) and the trip's
-- own ACTIVE confirmed constraints (trip_constraints, confirmed_at is not null). Deduped per
-- (kind, flag); severity is the strictest present (severe wins).
--
-- SECURITY DEFINER so it can read peers' self-only user_travel_constraints, but it returns
-- ONLY typed (kind, flag, severity) triples -- never a member id, never a raw profile row --
-- and raises 42501 unless the caller is a member of the trip.
create function public.trip_enforced_constraints(p_trip_id uuid)
returns table (
  kind public.trip_constraint_kind,
  flag text,
  severity public.trip_constraint_severity
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = auth.uid()) then
    raise exception 'not a member of this trip' using errcode = '42501';
  end if;

  return query
  with combined as (
    select tc.kind, tc.flag, tc.severity
    from public.trip_constraints tc
    where tc.trip_id = p_trip_id and tc.confirmed_at is not null
    union all
    select uc.kind, uc.flag, uc.severity
    from public.trip_members m
    join public.user_travel_constraints uc on uc.user_id = m.user_id
    where m.trip_id = p_trip_id
      and uc.retired_at is null
      and uc.confirmed_at is not null
  )
  select c.kind, c.flag,
    (case when bool_or(c.severity = 'severe') then 'severe' else 'standard' end)::public.trip_constraint_severity
  from combined c
  group by c.kind, c.flag;
end;
$$;
revoke all on function public.trip_enforced_constraints(uuid) from public, anon;
grant execute on function public.trip_enforced_constraints(uuid) to authenticated;

comment on function public.trip_enforced_constraints(uuid) is
  'Hard-constraint gate input (spec §3.2): union of members'' active global confirmed constraints + the trip''s active confirmed constraints, deduped, strictest severity. Non-attributable; member-only.';
```

- [ ] **Step 4: Run — expect PASS.** Also `tests/database/migrations.test.ts` +
  `tests/database/constraints-rls.test.ts` (unchanged view still there).
- [ ] **Step 5: Commit** — `feat(db): trip_enforced_constraints union projection`.

---

## Task 2 — wire it into the repository

**Files:** Modify `lib/repositories/supabase-trip-repository.ts`; add
`tests/repositories/enforced-constraints.test.ts`.

- [ ] **Step 1: Write `tests/repositories/enforced-constraints.test.ts` (RED).**

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseTripRepository } from "@/lib/repositories/supabase-trip-repository";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })) },
    rpc,
  } as unknown as SupabaseClient;
  return { db, rpc };
}

describe("listConfirmedConstraints via trip_enforced_constraints", () => {
  it("calls the union RPC and parses typed rows", async () => {
    const { db, rpc } = client({ data: [
      { kind: "dietary", flag: "no_peanut", severity: "severe" },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard" },
    ], error: null });
    const rows = await new SupabaseTripRepository(db).listConfirmedConstraints("12345678-1234-4123-8123-123456789012");
    expect(rpc).toHaveBeenCalledWith("trip_enforced_constraints", { p_trip_id: "12345678-1234-4123-8123-123456789012" });
    expect(rows).toEqual([
      { kind: "dietary", flag: "no_peanut", severity: "severe" },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard" },
    ]);
  });

  it("maps an RPC error through databaseError", async () => {
    const { db } = client({ data: null, error: { code: "42501" } });
    await expect(new SupabaseTripRepository(db).listConfirmedConstraints("12345678-1234-4123-8123-123456789012"))
      .rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (still reads `confirmed_trip_constraints`).

- [ ] **Step 3: Edit `listConfirmedConstraints`** (around line 145):

```ts
  async listConfirmedConstraints(tripId: string): Promise<ConfirmedConstraintFlag[]> {
    await this.userId();
    const { data, error } = await this.client.rpc("trip_enforced_constraints", { p_trip_id: tripId });
    if (error) databaseError(error);
    return ((data ?? []) as unknown[]).map((row) => confirmedConstraintRowSchema.parse(row));
  }
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`; `npm run lint`;
  `npx vitest run tests/api/trip-proposals.test.ts tests/api/schedule-validation.test.ts`
  (they mock the whole repo, so unaffected — confirm).
- [ ] **Step 5: Commit** — `feat(planning): gate evaluates global + trip constraints`.

---

## Task 3 — status doc + verification + finish

- [ ] **Step 1: Update `docs/implementation-status.md`.** In the Phase 1 row and the
  Task 1.6 / Task 1.7 sections, record what shipped on `feat/travel-dna-safety-pivot`:
  safety-first global onboarding + first-login gate + `/preferences`; organizer-framed
  `/chats` + `create_trip_group`; per-trip member entry + `trip_alignment_summary`;
  shared selected-trip shell; the gate now unions global + trip constraints. Keep the
  "Required migration work (not started)" bullets that are now done struck or moved to a
  "Done in the safety-first pivot" subsection. List the **explicit follow-ups**: retire
  `trip-setup-dashboard` + its Playwright spec; retire the trip-scoped onboarding
  route/action/wizard/nudge once hosted backfill counts verify (spec §4.6); POI
  candidate-card ratings; ε-greedy soft-default reweighting.

- [ ] **Step 2: Append a section to `docs/testing/travel-dna-backfill-runbook.md`** (or a
  new `docs/testing/safety-first-pivot-acceptance.md`) — the hosted acceptance path:
  new user → `/onboarding` → `/chats` → create organizer frame → enter chat → fill member
  entry → second user joins → alignment summary appears → a severe global constraint
  rejects an unsafe POI in that trip; verify Supabase rows and two-user RLS isolation.

- [ ] **Step 3: Full sweep** — `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run build`. All green.

- [ ] **Step 4: Commit** — `docs(status): record the safety-first pivot`.

- [ ] **Step 5: Update the umbrella plan** — tick Slice 6; the slice table is now all ✅.

- [ ] **Step 6: REQUIRED SUB-SKILL** — superpowers:finishing-a-development-branch: verify
  tests, present the merge/PR options for `feat/travel-dna-safety-pivot`, execute the choice.

---

## Self-review

1. **Spec coverage:** §3.2 gate evaluates the union of each member's active global confirmed
   constraints + the trip's active confirmed constraints ✔ (T1 function, T2 wiring); §6
   "planner/ranking code obtains only the minimum typed projection through narrowly scoped
   server functions" ✔ (SECURITY DEFINER, returns `(kind, flag, severity)` only, member-gated);
   fail-closed severity ✔ (strictest-wins in the projection; the gate itself already fails
   closed on severe). Soft-default reweighting + social-role privacy — N/A after the pivot
   (no recommender yet; no global social role), documented.
2. **No behaviour regression:** every `listConfirmedConstraints` consumer keeps the same
   `ConfirmedConstraintFlag[]` shape; repo tests that mock the whole repo are untouched.
3. **Isolation:** `trip_enforced_constraints` raises `42501` for a non-member / anon before
   reading anything, and never returns a `user_id`.
