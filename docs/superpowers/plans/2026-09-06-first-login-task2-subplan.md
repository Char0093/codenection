# Task 2 sub-plan — global profile/constraints + draft trips

> Expands Task 2 of `2026-09-06-first-login-travel-dna-chat-groups.md` into a file-by-file
> design. One migration + one new PGlite test file. **No app code** (routes/actions/wizard
> are Tasks 4–6). Additive + relaxing only — nothing is dropped, so it ships independently
> of the Task 3 backfill.

## Files

| File | Action |
| --- | --- |
| `supabase/migrations/202609060002_user_travel_profile_chat_groups.sql` | **create** — everything below |
| `tests/database/user-onboarding-rls.test.ts` | **create** — mirrors `tests/database/onboarding-rls.test.ts` harness |
| `tests/database/migrations.test.ts` | **maybe touch** — see §6 (function-privilege check at line ~653) |

Nothing else. `lib/repositories/*`, routes, and the wizard are untouched until Tasks 4–6.

---

## 1. `user_travel_profiles` — global Travel DNA baseline

Mirrors `202609060001`'s `traveler_profiles` but keyed on the **user**, not a trip member,
and **self-only** (no owner/planner on-behalf carve-out — spec §3.1 "self-read/self-write").

```sql
create table public.user_travel_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  travel_vibe public.traveler_travel_vibe,
  budget_lean public.budget_tier,
  pace public.pace_level not null default 'balanced',
  social_role public.traveler_social_role,
  serendipity_epsilon numeric not null default 0.2 check (serendipity_epsilon between 0.0 and 0.3),
  mobility_threshold_m int check (mobility_threshold_m is null or mobility_threshold_m between 0 and 50000),
  onboarding_completed_at timestamptz,
  profile_revision bigint not null default 1 check (profile_revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_travel_profiles_completed_shape check (
    onboarding_completed_at is null
    or (budget_lean is not null and serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3))
  )
);
```

**Triggers** (dedicated fns, each `revoke all ... from public, anon, service_role`, `set search_path = ''`):
- `user_travel_profiles_set_initial_revision` — `BEFORE INSERT`, forces `new.profile_revision := 1`.
- `user_travel_profiles_bump_revision` — `BEFORE UPDATE`, `new.updated_at := now()`, `new.profile_revision := old.profile_revision + 1` (ignores any supplied value).

**Grants** (column-scoped; `profile_revision` / `created_at` / `updated_at` never client-writable; `user_id` insertable, not updatable):
```sql
revoke all on public.user_travel_profiles from public, anon, authenticated, service_role;
grant select, delete on public.user_travel_profiles to authenticated;
grant insert (user_id, travel_vibe, budget_lean, pace, social_role,
              serendipity_epsilon, mobility_threshold_m, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;
grant update (travel_vibe, budget_lean, pace, social_role,
              serendipity_epsilon, mobility_threshold_m, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;
```

**RLS** — self only, all four verbs:
```sql
alter table public.user_travel_profiles enable row level security;
create policy "self read"   on public.user_travel_profiles for select to authenticated using (user_id = auth.uid());
create policy "self insert" on public.user_travel_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "self update" on public.user_travel_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "self delete" on public.user_travel_profiles for delete to authenticated using (user_id = auth.uid());
```
No other member — including any trip owner — can select another user's row. `social_role`
has no separate carve-out to leak through.

---

## 2. `user_travel_constraints` — globally confirmed typed requirements

Same typed vocabularies + severity rules as `trip_constraints` (`202609050002` +
`202609050006`), plus a supersession audit chain (spec §3.1).

```sql
create table public.user_travel_constraints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.trip_constraint_kind not null,
  flag text not null,
  severity public.trip_constraint_severity not null default 'standard',
  source public.trip_constraint_source not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,                 -- non-null once enforced
  supersedes_id uuid references public.user_travel_constraints(id) on delete set null,
  retired_at timestamptz,
  constraint user_travel_constraints_dietary_flag_valid check (
    kind <> 'dietary' or flag in ('halal','vegetarian','vegan','no_seafood','no_shellfish',
      'no_pork','no_beef','no_dairy','no_gluten','no_peanut','other')),
  constraint user_travel_constraints_religious_flag_valid check (
    kind <> 'religious_access' or flag in ('modest_dress_required','prayer_space_needed','no_alcohol_venues','other')),
  constraint user_travel_constraints_mobility_flag_valid check (
    kind <> 'mobility' or flag in ('wheelchair_accessible_required','limited_walking_distance','no_stairs','other'))
);

-- At most one ACTIVE row per (user, kind, flag). An edit retires + inserts a replacement
-- with supersedes_id in one transaction; removal retires without replacement.
create unique index user_travel_constraints_active_uniq
  on public.user_travel_constraints (user_id, kind, flag) where retired_at is null;
create index user_travel_constraints_user_idx on public.user_travel_constraints (user_id);

-- Enforcement reads go through a view that only ever shows active, confirmed rows.
create view public.active_user_travel_constraints with (security_invoker = true) as
  select * from public.user_travel_constraints where retired_at is null and confirmed_at is not null;
```

**Grants / RLS** — self only. `grant select, insert on public.user_travel_constraints to authenticated`.
**No `update`/`delete` grant** for `authenticated` (supersession happens inside the RPC in this
slice; the `/preferences` editor's retire/replace path is Task 5, which will add a narrow
`update (retired_at)` grant + policy then). Anonymous denied; cross-user denied.

**Reviewer adjustment 2 — `active_user_travel_constraints`:** `with (security_invoker = true)`
(so it runs the caller's RLS, not the view owner's), **and** `revoke all on
public.active_user_travel_constraints from public, anon, authenticated;` with **no grant** —
the view is only a future server-side projection surface (Task 8), so nothing reads it
directly yet. A dedicated test asserts a second authenticated user gets zero rows through the
**table and** the view.

```sql
create policy "self read"   on public.user_travel_constraints for select to authenticated using (user_id = auth.uid());
create policy "self insert" on public.user_travel_constraints for insert to authenticated with check (user_id = auth.uid() and created_by = auth.uid());
```

---

## 3. `submit_user_onboarding(p_expected_revision bigint, p_answers jsonb) returns bigint`

`security invoker`, `set search_path = ''`, `revoke all ... from public, anon`,
`grant execute to authenticated`. A near-copy of `202609060001`'s `submit_onboarding`,
minus the trip: `v_user_id := auth.uid()`, null → `raise ... errcode '42501'`.

Steps (identical structure to `submit_onboarding`):
1. **Auth.** `v_user_id := auth.uid()`; null → `42501`.
2. **Zod-independent input validation** — reuse the exact `_onboarding_check_flags(jsonb, text[])`
   helper already defined in `202609060001` (it is `grant execute to authenticated`, so this
   `security invoker` RPC can call it). Same checks: `mode` in `('quick','full')`; `dealbreakers`
   an object; each kind an array within vocab length with only known flags; `walkingCapM`
   number-or-null in `[0,50000]` and integral (the `::numeric` + `trunc` form `ca215f8` landed);
   full-mode `vibe`/`pace`/`socialRole` present + valid; `surpriseDial` integer in `[1,5]`.
   Any failure → `22023`.
3. **CAS.** Read `profile_revision` + `onboarding_completed_at` from `user_travel_profiles`
   for `v_user_id`. Existing row with `profile_revision <> p_expected_revision` → `40001`;
   no row and `p_expected_revision <> 0` → `40001`.
4. **Dealbreakers — add-only** (first-write onboarding; editing/removal is Task 5). For each
   submitted `(kind, flag)`:
   `insert into public.user_travel_constraints (user_id, kind, flag, severity, source, created_by, confirmed_at)
    values (v_user_id, kind, flag, <severity case>, 'manual', v_user_id, v_now)
    on conflict (user_id, kind, flag) where retired_at is null do nothing;`
   `<severity case>` = `dietary`/`no_peanut`,`no_shellfish` → `severe`; `mobility`/`wheelchair_accessible_required`
   → `severe`; else `standard` — byte-identical to `202609060001` and `lib/domain/constraints.ts`.
   No pending-row concept here (nothing writes unconfirmed global rows yet), so no `P0001` path.
5. **Profile upsert last.**
   - no row → `insert ... on conflict (user_id) do nothing returning profile_revision`; null → `40001`.
   - row exists → `update ... where user_id = v_user_id and profile_revision = p_expected_revision returning profile_revision`; null → `40001`.
   - `full` writes `travel_vibe, pace, social_role, budget_lean, mobility_threshold_m,
     onboarding_completed_at, serendipity_epsilon = round((((surpriseDial-1)/4.0)*0.3),3)`.
   - `quick` writes `budget_lean, mobility_threshold_m, onboarding_completed_at`, and
     `serendipity_epsilon = case when v_prev_completed_at is null then 0.150 else
     public.user_travel_profiles.serendipity_epsilon end`; never `travel_vibe`/`pace`/`social_role`.
6. `return v_new_revision;`

Error-code contract (for the Task 5 action's mapper): `42501` / `40001` / `22023` — same
messages as `mapRpcError` in `app/actions/onboarding.ts`.

---

## 4. Draft trips — the invasive part

### 4.1 `status` column + one-way auto-promote

**Reviewer adjustment 1** — initialize existing rows to `ready` via the column default, not a
bulk `UPDATE`, then flip the default for future inserts:
```sql
create type public.trip_status as enum ('draft', 'ready');
alter table public.trips add column status public.trip_status not null default 'ready';  -- every existing row -> ready
alter table public.trips alter column status set default 'draft';                        -- future inserts -> draft
```

Auto-promote so `status` is **server-managed, never client-writable** (no grant for it):
```sql
create function public.trips_promote_when_ready()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'draft'
     and new.destination_name is not null
     and public.ordinary_trim(new.destination_name) <> ''
     and new.start_date is not null and new.end_date is not null
     and new.end_date >= new.start_date then
    new.status := 'ready';
  end if;
  return new;   -- one-way: never demotes ready -> draft
end; $$;
revoke all on function public.trips_promote_when_ready() from public, anon, service_role;
create trigger trips_promote_when_ready before insert or update on public.trips
  for each row execute function public.trips_promote_when_ready();
```
Interaction with existing `BEFORE` triggers on `trips` (`set_updated_at`, `bump_trip_revision`):
independent concerns; multiple `BEFORE` triggers fire in name order — no conflict. Verified
against the diff during implementation.

### 4.2 Relax the NOT NULLs + replace the strict date check

```sql
alter table public.trips
  alter column destination_name drop not null,
  alter column start_date drop not null,
  alter column end_date drop not null;

-- The inline `check (end_date >= start_date)` from 202609020001 is an unnamed constraint.
-- Implementation step: look it up
--   select conname from pg_constraint where conrelid='public.trips'::regclass and contype='c'
--     and pg_get_constraintdef(oid) ilike '%end_date >= start_date%';
-- then `alter table public.trips drop constraint <that name>;`
alter table public.trips add constraint trips_ready_requires_setup check (
  status = 'draft'
  or (destination_name is not null and start_date is not null and end_date is not null
      and end_date >= start_date)
);
```
The three `NOT VALID` checks from `202609030004` (`trips_destination_bounds`,
`trips_calendar_bounds`, `trips_notes_bounds`) are **kept unchanged** — each is
`<expr>`-on-non-null and evaluates to NULL (→ passes) when its column is null, so a draft
row satisfies them.

Grants: **no change**. The existing `insert (name, owner_user_id, destination_name,
start_date, end_date, budget_tier, pace, notes)` already lets a client insert a name-only
row now that the three columns are nullable; `status` is not added to any grant.

### 4.3 `create_trip_group(p_name text) returns uuid`

`security invoker`, `set search_path = ''`, `revoke all ... from public, anon`,
`grant execute to authenticated`.
```sql
-- validate: 1..120 after ordinary_trim
insert into public.trips (name, owner_user_id)
values (public.ordinary_trim(p_name), auth.uid())
returning id;
```
RLS INSERT policy (`owner_user_id = auth.uid()`) permits it; the existing
`trips_create_owner_membership` AFTER INSERT trigger creates the owner `trip_members` row in
the same statement (atomic); `trips_promote_when_ready` leaves it `draft` (no destination);
`revision` defaults to 1. `auth.uid()` null → the INSERT's `with check` fails → surfaces as
`42501`; the RPC also guards explicitly and raises `42501` for a clean message.

### 4.4 Generation gate (DB backstop)

Add a readiness guard to the two SECURITY DEFINER chokepoints the app calls before/at
generation (`202609030004`):
- `reserve_generation(target_trip_id)` — after it loads the trip, `if v_trip.status <> 'ready'
  then raise exception 'trip setup is incomplete' using errcode = '22023'; end if;` (before
  the rate-limit reservation).
- `save_trip_proposal(...)` — same guard after its trip load, as defence in depth.

`decide_trip_proposal` needs no guard (a proposal cannot exist without `save_trip_proposal`).
The app-layer "don't even show Generate" is Task 6; this is the backstop so a direct call
can't materialise a plan for a nameless draft.

---

## 5. Test file — `tests/database/user-onboarding-rls.test.ts`

Harness copied from `tests/database/onboarding-rls.test.ts` (auth shim, migration loader,
`actor()`), fixtures: two `auth.users` (`userA`, `userB`), one trip owned by `userA` (for the
`create_trip_group` / draft cases).

| Group | Cases |
| --- | --- |
| `user_travel_profiles` RLS | anonymous denied; `userA` self read+write; `userB` (and any trip owner) cannot select `userA`'s row; `serendipity_epsilon` out of range → `23514`; `mobility_threshold_m` 50001 → `23514`; direct `update` naming `profile_revision` / `user_id` → `42501`; `profile_revision` bumps on update; completed-shape CHECK both failure modes + success → `23514` |
| `user_travel_constraints` RLS | anonymous denied; self read+write; cross-user denied; unlisted flag → `23514`; second **active** `(user,kind,flag)` insert → `23505`; a retired row lets a fresh active row insert; `active_user_travel_constraints` view hides retired + unconfirmed |
| `submit_user_onboarding` happy | full → row + confirmed constraints + `serendipity_epsilon = "0.150"` for dial 3; quick first → `"0.150"`, `pace = 'balanced'`, vibe/role null; quick redo of a completed profile preserves epsilon/vibe/pace/role; per-flag **severity parity** loop over `DIETARY_FLAGS`/`RELIGIOUS_ACCESS_FLAGS`/`MOBILITY_FLAGS` vs `defaultSeverity`/`defaultReligiousAccessSeverity`/`defaultMobilitySeverity` |
| `submit_user_onboarding` failure | anonymous → `42501`; stale `p_expected_revision` → `40001` **with atomic rollback** (pre-insert an active `no_pork`, submit `["halal","no_pork"]` with a bad revision, assert `halal` absent); no-row + non-zero revision → `40001`; a table of malformed `p_answers` → each `22023`, nothing written |
| `create_trip_group` | anonymous → `42501`; `userA` → returns a uuid, the `trips` row is `status='draft'` with null destination/dates, and a `trip_members` owner row exists for `userA`; blank / 121-char name → raise |
| draft trips | `insert into trips (name, owner_user_id)` as `userA` → succeeds, `status='draft'`; `update` filling destination + valid dates → `status` auto-flips to `'ready'`; `update` to only a destination (no dates) stays `'draft'`; `reserve_generation` / `save_trip_proposal` on a `draft` trip → raise `22023` (or its mapped code) |
| PGlite marshaling | `bigint` (`submit_user_onboarding` return, `profile_revision`) asserted as **number**; `numeric` (`serendipity_epsilon`) as **string** `"0.150"`; `timestamptz` as **Date** — same rulings as the onboarding slice (T2-a / T3-b / T3-c) |

`migrations.test.ts` (111 tests) must stay green — nullable columns + the new triggers do
not affect its full-data inserts; run it as part of the gate.

### Reviewer-required assertions (lock these in)

- `create_trip_group` — unauthenticated caller → `42501`; blank / whitespace-only name → raise.
- Auto-promotion — a `draft` row promotes to `ready` only with a **trimmed non-empty**
  `destination_name` **and** two valid, complete dates (`end_date >= start_date`); a
  destination of `'   '`, or dates missing, keeps it `draft`.
- `reserve_generation` replacement — the `dev_test@gmail.com` rate-limit exemption still
  works (dev user is not throttled); a real user still is.
- Draft rejection in `reserve_generation` — no `generation_reservations` row is written and
  no quota is consumed (assert count before == count after).
- `save_trip_proposal` — a `draft` trip is rejected **before** any `agent_proposals` insert
  (assert no proposal row exists after the raise).
- Existing complete trips are `ready` immediately after the migration replays (a full-data
  trip inserted before `202609060002` reads back `status = 'ready'`).
- `submit_user_onboarding` calls `public._onboarding_check_flags(jsonb, text[])` through its
  existing qualified signature from `202609060001`; this migration does **not** redefine it
  or touch its grants.

---

## 6. `migrations.test.ts` function-privilege check

`tests/database/migrations.test.ts:653` selects every `public` function granted `EXECUTE` to
`PUBLIC` and asserts it against an allowlist. **Rule for this migration:** every new function
(`user_travel_profiles_set_initial_revision`, `user_travel_profiles_bump_revision`,
`trips_promote_when_ready`, `submit_user_onboarding`, `create_trip_group`) gets an explicit
`revoke all on function ... from public, anon, service_role;`. During implementation, run
`migrations.test.ts` — if it still flags one, read the allowlist block (~lines 650–675) and
add the name there; do **not** guess the allowlist shape. (`ca215f8` did the same revoke for
the `202609060001` trigger helpers and the test stayed green, so revoke-only is expected to
suffice.)

---

## 7. Decisions made in this sub-plan (flag if you disagree)

1. **`create_trip_group` is `security invoker`, not definer** — the caller already has the
   `insert (name, owner_user_id)` grant + a permissive INSERT policy, so definer buys nothing
   and widens authority. (Same reasoning as the `202609060001` triggers.)
2. **`status` default is `'draft'` + a one-way auto-promote trigger**, rather than default
   `'ready'` + explicit draft-setting. This means the existing `POST /api/trips` full-trip
   insert also transits `draft`→`ready` in the same BEFORE-INSERT trigger (never observable),
   and `status` needs no client grant and no client write path. One-way: a `ready` trip whose
   dates are later cleared does **not** fall back to `draft` (out of scope; also the
   `trips_ready_requires_setup` check would then reject clearing them, which is the correct
   failure).
3. **`submit_user_onboarding` is add-only for constraints** (like `202609060001` was for the
   initial onboarding). Retire/replace/remove is the `/preferences` editor (Task 5), which
   adds the narrow `update (retired_at)` grant + policy then.
4. **Generation gate lives in `reserve_generation` + `save_trip_proposal`** (the two RPCs the
   app calls at generation time), not in a new trigger on `agent_proposals`.
5. **The old `traveler_profiles` / `trip_constraints` / `202609060001` machinery is left
   entirely intact.** Backfill from it is Task 3; retiring it is post-Task-3 per spec §4.6.
6. **No app wiring in Task 2.** `lib/repositories/*`, the routes, and the wizard keep using
   the trip-scoped path until Tasks 4–6. Confirmed nothing in `SupabaseTripRepository`
   breaks from the schema change (it never selects `status`; draft trips with null
   destination/dates are not produced by any existing path).

## 8. Commit

One commit: `feat(onboarding): global travel profile/constraints + draft trip groups (Task 2)`.
Gate before commit: `npm run lint`, `npm run typecheck`, `npm test` (expect the new DB file
+ 111 migration tests + all prior green), `npm run build`.
