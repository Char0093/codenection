# Travel DNA global backfill — hosted verification runbook

Migration: `supabase/migrations/202609060003_backfill_global_travel_dna.sql`
(first-login Travel DNA / chat-groups plan, Task 3).

The migration is **additive, deterministic, and idempotent**. It creates two provenance
columns, a re-runnable `_run_travel_dna_backfill()` function, runs it once, and creates the
admin-only `travel_dna_backfill_report` view. It drops nothing — `traveler_profiles`,
`trip_constraints`, and the trip-scoped `202609060001` onboarding path stay live through the
compatibility window (spec §4.5). Local coverage: `tests/database/travel-dna-backfill.test.ts`
(9 cases) + `tests/database/migrations.test.ts` (full-sequence apply).

> **Do not run against hosted Supabase yet.** This runbook is the checklist for when it is
> applied. Run every query in the Supabase SQL editor as the `postgres`/service role (it
> bypasses RLS, which the aggregate queries need).

---

## 1. Before applying — snapshot the source

```sql
-- eligible source users: have at least one COMPLETED, shape-valid traveler_profiles row
select count(distinct tm.user_id) as eligible_source_users
from public.traveler_profiles tp
join public.trip_members tm on tm.id = tp.trip_member_id
where tp.onboarding_completed_at is not null
  and tm.user_id is not null
  and tp.budget_lean is not null
  and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3);

-- distinct (user, kind, flag) keys eligible to globalize
select count(*) as eligible_constraint_keys from (
  select distinct tm.user_id, tc.kind, tc.flag
  from public.trip_constraints tc
  join public.trip_members tm on tm.id = tc.trip_member_id
  where tc.confirmed_at is not null and tc.source = 'manual' and tm.user_id is not null
    and tc.kind in ('dietary','religious_access','mobility') and tc.flag <> 'other'
) k;

-- users who ALREADY have a global profile (native onboarding before the backfill)
select count(*) as pre_existing_global_profiles from public.user_travel_profiles;

-- raw source table sizes, to prove nothing is deleted
select
  (select count(*) from public.traveler_profiles)  as traveler_profiles_rows,
  (select count(*) from public.trip_constraints)   as trip_constraints_rows;
```

Record these four numbers.

## 2. Apply the migration

Deploy `202609060003_backfill_global_travel_dna.sql` through the normal migration path. It runs
`select public._run_travel_dna_backfill();` once as part of the transaction.

## 3. After applying — verify

### 3.1 The report

```sql
select * from public.travel_dna_backfill_report;
```

Expected relationships (must all hold):

| Field | Expectation |
| --- | --- |
| `eligible_source_users` | equals the pre-apply `eligible_source_users` snapshot |
| `backfilled_profiles` | `<= eligible_source_users` (users who onboarded natively are skipped by `on conflict`) |
| `backfilled_profiles + pre_existing_global_profiles_that_were_also_eligible` | reconciles to the users now holding a global profile |
| `native_profiles` | equals the pre-apply `pre_existing_global_profiles` |
| `backfilled_constraints` | `<= eligible_constraint_keys` (cross-trip duplicates collapse) |
| `eligible_constraint_keys` | equals the pre-apply snapshot |
| `skipped_ambiguous_or_inferred_rows` | `>= 0`; equals the count of confirmed `trip_constraints` that are `source <> 'manual'`, `flag = 'other'`, or a non-typed kind |

### 3.2 Provenance is intact

```sql
-- every backfilled profile points at a real, completed source row
select count(*) as broken_profile_provenance
from public.user_travel_profiles p
where p.backfilled_from_trip_member_id is not null
  and not exists (
    select 1 from public.traveler_profiles tp
    where tp.trip_member_id = p.backfilled_from_trip_member_id
      and tp.onboarding_completed_at is not null);   -- expect 0

select count(*) as broken_constraint_provenance
from public.user_travel_constraints c
where c.backfilled_from_trip_constraint_id is not null
  and not exists (
    select 1 from public.trip_constraints tc
    where tc.id = c.backfilled_from_trip_constraint_id
      and tc.confirmed_at is not null and tc.source = 'manual');   -- expect 0
```

### 3.3 No ambiguous or inferred data was globalized

```sql
select count(*) as leaked_ambiguous_rows
from public.user_travel_constraints
where flag = 'other'
   or source <> 'manual'
   or kind not in ('dietary','religious_access','mobility');   -- expect 0
```

### 3.4 One profile per user, deterministically chosen

```sql
select user_id, count(*) from public.user_travel_profiles group by user_id having count(*) > 1;
-- expect zero rows (user_id is the primary key, so this is structural, but confirm anyway)

-- spot check three users: the global profile must equal their NEWEST completed trip profile
with pick as (
  select distinct on (tm.user_id) tm.user_id,
    tp.travel_vibe, tp.budget_lean, tp.pace, tp.social_role, tp.serendipity_epsilon,
    tp.mobility_threshold_m, tp.onboarding_completed_at
  from public.traveler_profiles tp
  join public.trip_members tm on tm.id = tp.trip_member_id
  where tp.onboarding_completed_at is not null and tm.user_id is not null
    and tp.budget_lean is not null and tp.serendipity_epsilon in (0.0,0.075,0.15,0.225,0.3)
  order by tm.user_id, tp.onboarding_completed_at desc, tp.updated_at desc, tp.trip_member_id desc
)
select g.user_id,
  (g.travel_vibe, g.budget_lean, g.pace, g.social_role, g.serendipity_epsilon,
   g.mobility_threshold_m, g.onboarding_completed_at)
   is not distinct from
  (p.travel_vibe, p.budget_lean, p.pace, p.social_role, p.serendipity_epsilon,
   p.mobility_threshold_m, p.onboarding_completed_at) as matches_newest_completed
from public.user_travel_profiles g
join pick p using (user_id)
where g.backfilled_from_trip_member_id is not null
limit 20;
-- every `matches_newest_completed` must be true
```

### 3.5 Compatibility window — nothing was deleted

```sql
select
  (select count(*) from public.traveler_profiles) as traveler_profiles_rows,
  (select count(*) from public.trip_constraints)  as trip_constraints_rows;
-- both equal the pre-apply snapshot
```

### 3.6 Two-user RLS isolation (do this from the app / an anon+JWT client, not the SQL editor)

Sign in as user A, then user B, and confirm each of:

```sql
select * from public.user_travel_profiles;      -- returns only the caller's row
select * from public.user_travel_constraints;   -- returns only the caller's rows
select * from public.active_user_travel_constraints;  -- permission denied (no grant this slice)
```

## 4. Idempotency check (safe to run on hosted)

```sql
select
  (select count(*) from public.user_travel_profiles)    as before_p,
  (select count(*) from public.user_travel_constraints) as before_c \gset

select public._run_travel_dna_backfill();

select
  (select count(*) from public.user_travel_profiles)    as after_p,
  (select count(*) from public.user_travel_constraints) as after_c;
-- after_p = before_p, after_c = before_c ; profile_revision on every backfilled row still 1
```

## 5. Rollback (only while compatibility code is still in place)

The backfill has clean provenance, so it is reversible as long as nothing downstream has
written to the global tables since:

```sql
delete from public.user_travel_constraints where backfilled_from_trip_constraint_id is not null;
delete from public.user_travel_profiles    where backfilled_from_trip_member_id     is not null;
```

Do **not** run this after users have edited their global profile through the Task 5
`/preferences` editor — check `profile_revision > 1` or `updated_at` drift first.

## 6. Gate for removing compatibility code

Do not retire `traveler_profiles` / `trip_constraints` reads or the `202609060001`
onboarding path until §3.1–§3.5 pass on hosted and the row-for-row spot check in §3.4 is
clean for a representative sample of users (spec §4.6).
