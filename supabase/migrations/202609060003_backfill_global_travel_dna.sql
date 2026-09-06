-- First-login Travel DNA + trip chat groups, Task 3 -- data backfill + compatibility.
--
-- Additive and idempotent. NOTHING is dropped: traveler_profiles, trip_constraints, the
-- 202609060001 trip-scoped RPC/route, and every existing read stay intact through the
-- compatibility window. Compatibility code is removed only after the hosted verification in
-- docs/testing/travel-dna-backfill-runbook.md passes (spec §4.5-4.6).
--
-- Backfill rules:
--  * Global profile: the SINGLE most-recently-completed traveler_profiles row per user,
--    deterministically tie-broken. `on conflict (user_id) do nothing` -- never overwrites a
--    profile the user already created through the new global flow, and re-running is a no-op.
--  * Global constraints: only CONFIRMED, source = 'manual' dietary / religious_access /
--    mobility rows whose flag is a real general requirement. `flag = 'other'` is ambiguous
--    (free-form) and stays trip-scoped; chat/voice/social candidates stay trip-scoped.
--    Deduped across trips by the (user, kind, flag) partial unique index. Severity is
--    recomputed from the flag so it matches submit_user_onboarding exactly.

-- ---------------------------------------------------------------------------------------------
-- Provenance columns (additive) -- which source row seeded each global row. NULL for rows
-- written by the live onboarding flow. Makes the backfill auditable, its counts exact, and
-- its removal safe.
-- ---------------------------------------------------------------------------------------------
alter table public.user_travel_profiles
  add column backfilled_from_trip_member_id uuid references public.trip_members(id) on delete set null;
alter table public.user_travel_constraints
  add column backfilled_from_trip_constraint_id uuid references public.trip_constraints(id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- Re-runnable backfill body. The migration calls it once; the local idempotency test calls it
-- again. Runs as its (superuser) invoker during migration -- reads across all users' rows.
-- ---------------------------------------------------------------------------------------------
create function public._run_travel_dna_backfill()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- 1. One global profile per user: newest completed traveler_profiles row.
  insert into public.user_travel_profiles
    (user_id, travel_vibe, budget_lean, pace, social_role, serendipity_epsilon,
     mobility_threshold_m, onboarding_completed_at, backfilled_from_trip_member_id)
  select distinct on (tm.user_id)
    tm.user_id, tp.travel_vibe, tp.budget_lean, tp.pace, tp.social_role, tp.serendipity_epsilon,
    tp.mobility_threshold_m, tp.onboarding_completed_at, tp.trip_member_id
  from public.traveler_profiles tp
  join public.trip_members tm on tm.id = tp.trip_member_id
  where tp.onboarding_completed_at is not null
    and tm.user_id is not null
    and tp.budget_lean is not null
    and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3)   -- must satisfy the completed-shape CHECK
  order by tm.user_id,
           tp.onboarding_completed_at desc,
           tp.updated_at desc,
           tp.trip_member_id desc                                   -- final deterministic tie-break
  on conflict (user_id) do nothing;

  -- 2. Global constraints: confirmed, manual, non-'other' dietary/religious/mobility rows,
  --    deduped per (user, kind, flag). Severity recomputed from the flag.
  insert into public.user_travel_constraints
    (user_id, kind, flag, severity, source, created_by, created_at, confirmed_at,
     backfilled_from_trip_constraint_id)
  select distinct on (tm.user_id, tc.kind, tc.flag)
    tm.user_id, tc.kind, tc.flag,
    (case
       when tc.kind = 'dietary' and tc.flag in ('no_peanut', 'no_shellfish') then 'severe'
       when tc.kind = 'mobility' and tc.flag = 'wheelchair_accessible_required' then 'severe'
       else 'standard'
     end)::public.trip_constraint_severity,
    'manual'::public.trip_constraint_source,
    tm.user_id,
    min(tc.created_at) over (partition by tm.user_id, tc.kind, tc.flag),
    min(tc.confirmed_at) over (partition by tm.user_id, tc.kind, tc.flag),
    tc.id
  from public.trip_constraints tc
  join public.trip_members tm on tm.id = tc.trip_member_id
  where tc.confirmed_at is not null
    and tc.source = 'manual'
    and tm.user_id is not null
    and tc.kind in ('dietary', 'religious_access', 'mobility')
    and tc.flag <> 'other'
  order by tm.user_id, tc.kind, tc.flag, tc.confirmed_at asc, tc.id asc
  on conflict (user_id, kind, flag) where retired_at is null do nothing;
end;
$$;
revoke all on function public._run_travel_dna_backfill() from public, anon, authenticated, service_role;

select public._run_travel_dna_backfill();

-- ---------------------------------------------------------------------------------------------
-- Verification report. Aggregates across ALL users -> admin / SQL-console only, no grants.
-- ---------------------------------------------------------------------------------------------
create view public.travel_dna_backfill_report with (security_invoker = true) as
select
  (select count(distinct tm.user_id)
     from public.traveler_profiles tp
     join public.trip_members tm on tm.id = tp.trip_member_id
     where tp.onboarding_completed_at is not null and tm.user_id is not null
       and tp.budget_lean is not null
       and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3))          as eligible_source_users,
  (select count(*) from public.user_travel_profiles
     where backfilled_from_trip_member_id is not null)                        as backfilled_profiles,
  (select count(*) from public.user_travel_profiles
     where backfilled_from_trip_member_id is null)                            as native_profiles,
  (select count(*) from public.user_travel_constraints
     where backfilled_from_trip_constraint_id is not null)                    as backfilled_constraints,
  (select count(distinct (tm.user_id, tc.kind, tc.flag))
     from public.trip_constraints tc
     join public.trip_members tm on tm.id = tc.trip_member_id
     where tc.confirmed_at is not null and tc.source = 'manual' and tm.user_id is not null
       and tc.kind in ('dietary', 'religious_access', 'mobility') and tc.flag <> 'other')
                                                                             as eligible_constraint_keys,
  (select count(*)
     from public.trip_constraints tc
     join public.trip_members tm on tm.id = tc.trip_member_id
     where tc.confirmed_at is not null and tm.user_id is not null
       and (tc.source <> 'manual'
            or tc.flag = 'other'
            or tc.kind not in ('dietary', 'religious_access', 'mobility')))  as skipped_ambiguous_or_inferred_rows;
revoke all on public.travel_dna_backfill_report from public, anon, authenticated, service_role;

comment on view public.travel_dna_backfill_report is
  'Task 3 backfill audit. Admin-only. eligible_source_users >= backfilled_profiles (users who already onboarded natively are skipped by on-conflict). eligible_constraint_keys >= backfilled_constraints. See docs/testing/travel-dna-backfill-runbook.md.';
