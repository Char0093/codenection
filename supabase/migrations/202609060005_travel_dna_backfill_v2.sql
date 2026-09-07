-- First-login Travel DNA — rework the backfill for the safety-only profile (spec revised
-- 2026-09-07). 202609060003 already ran the backfill once against the pre-pivot columns;
-- those columns are gone after 202609060004, so replace _run_travel_dna_backfill() and the
-- audit view to match. Still additive, still idempotent (on-conflict-do-nothing), nothing
-- dropped. traveler_profiles / trip_constraints stay intact (compat window).

create or replace function public._run_travel_dna_backfill()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- 1. One global profile per user: the newest completed traveler_profiles row. Only
  --    travel_vibe + serendipity_epsilon survive on user_travel_profiles now.
  insert into public.user_travel_profiles
    (user_id, travel_vibe, serendipity_epsilon, onboarding_completed_at, backfilled_from_trip_member_id)
  select distinct on (tm.user_id)
    tm.user_id, tp.travel_vibe, tp.serendipity_epsilon, tp.onboarding_completed_at, tp.trip_member_id
  from public.traveler_profiles tp
  join public.trip_members tm on tm.id = tp.trip_member_id
  where tp.onboarding_completed_at is not null
    and tm.user_id is not null
    and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3)   -- must satisfy the completed-shape CHECK
  order by tm.user_id,
           tp.onboarding_completed_at desc,
           tp.updated_at desc,
           tp.trip_member_id desc                                   -- final deterministic tie-break
  on conflict (user_id) do nothing;

  -- 2. Global constraints: unchanged from 202609060003 -- confirmed, manual, non-'other'
  --    dietary / religious_access / mobility rows, deduped per (user, kind, flag). Severity
  --    recomputed from the flag so it matches submit_user_onboarding exactly.
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
-- Audit report, reworked to drop the removed budget_lean predicate.
-- ---------------------------------------------------------------------------------------------
drop view if exists public.travel_dna_backfill_report;
create view public.travel_dna_backfill_report with (security_invoker = true) as
select
  (select count(distinct tm.user_id)
     from public.traveler_profiles tp
     join public.trip_members tm on tm.id = tp.trip_member_id
     where tp.onboarding_completed_at is not null and tm.user_id is not null
       and tp.serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3))                as eligible_source_users,
  (select count(*) from public.user_travel_profiles
     where backfilled_from_trip_member_id is not null)                              as backfilled_profiles,
  (select count(*) from public.user_travel_profiles
     where backfilled_from_trip_member_id is null)                                  as native_profiles,
  (select count(*) from public.user_travel_constraints
     where backfilled_from_trip_constraint_id is not null)                          as backfilled_constraints,
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
            or tc.kind not in ('dietary', 'religious_access', 'mobility')))        as skipped_ambiguous_or_inferred_rows;
revoke all on public.travel_dna_backfill_report from public, anon, authenticated, service_role;

comment on view public.travel_dna_backfill_report is
  'Task 3 backfill audit, reworked for the safety-only profile (202609060005). Admin-only. eligible_source_users >= backfilled_profiles; eligible_constraint_keys >= backfilled_constraints. See docs/testing/travel-dna-backfill-runbook.md.';
