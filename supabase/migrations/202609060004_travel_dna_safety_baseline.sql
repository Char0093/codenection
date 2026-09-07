-- First-login Travel DNA + trip chat groups — safety-first pivot (spec revised 2026-09-07).
--
-- NOT purely additive: this drops user_travel_profiles.{budget_lean, pace, social_role,
-- mobility_threshold_m}, which shipped in 202609060002 against the pre-pivot design and are
-- read only by tests (no app/lib code consumes user_travel_profiles yet). It also replaces
-- create_trip_group(text) with the organizer trip frame and adds per-trip member entry.
--
-- Untouched (compat window, spec §4): traveler_profiles, trip_constraints, the 202609060001
-- trip-scoped submit_onboarding RPC + /api/trips/[tripId]/onboarding route, and the
-- five-screen wizard. The dev_test@gmail.com generation exemption is not touched here.
-- The Task-3 backfill function/report are reworked separately in 202609060005.

-- ===========================================================================================
-- 1. Shrink user_travel_profiles to the safety-only baseline (spec §3.1).
-- ===========================================================================================
alter table public.user_travel_profiles
  drop constraint user_travel_profiles_completed_shape,
  drop column budget_lean,
  drop column pace,
  drop column social_role,
  drop column mobility_threshold_m;

-- A completed row now only needs an on-grid dial — no budget_lean requirement.
alter table public.user_travel_profiles add constraint user_travel_profiles_completed_shape check (
  onboarding_completed_at is null
  or serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3)
);

-- The dropped columns fell out of the column-scoped grants automatically; restate for clarity.
revoke insert, update on public.user_travel_profiles from authenticated;
grant insert (user_id, travel_vibe, serendipity_epsilon, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;
grant update (travel_vibe, serendipity_epsilon, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;

comment on table public.user_travel_profiles is
  'Global per-user Travel DNA safety baseline (first-login onboarding, spec revised 2026-09-07): optional travel_vibe + optional serendipity_epsilon only. Self-only RLS.';

-- ===========================================================================================
-- 2. submit_user_onboarding — safety-vault dealbreakers + one OPTIONAL exploration dial.
--    Same (bigint, jsonb) signature and grants; body replaced.
-- ===========================================================================================
create or replace function public.submit_user_onboarding(p_expected_revision bigint, p_answers jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_revision bigint;
  v_prev_completed_at timestamptz;
  v_new_revision bigint;
  v_now timestamptz := now();
  v_dial int;
  v_epsilon numeric;
  v_kind text;
  v_flag text;
  v_severity public.trip_constraint_severity;
  v_dietary text[] := array['halal','vegetarian','vegan','no_seafood','no_shellfish','no_pork','no_beef','no_dairy','no_gluten','no_peanut','other'];
  v_religious text[] := array['modest_dress_required','prayer_space_needed','no_alcohol_venues','other'];
  v_mobility text[] := array['wheelchair_accessible_required','limited_walking_distance','no_stairs','other'];
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Zod-independent input validation (the RPC is directly callable).
  if jsonb_typeof(p_answers->'dealbreakers') is distinct from 'object' then
    raise exception 'dealbreakers must be an object' using errcode = '22023';
  end if;
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'dietary', v_dietary);
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'religiousAccess', v_religious);
  perform public._onboarding_check_flags(p_answers->'dealbreakers'->'mobility', v_mobility);

  -- Optional exploration dial: absent / null = skip; otherwise an integer 1..5.
  if (p_answers ? 'surpriseDial') and jsonb_typeof(p_answers->'surpriseDial') <> 'null' then
    if jsonb_typeof(p_answers->'surpriseDial') <> 'number'
       or (p_answers->>'surpriseDial')::numeric <> trunc((p_answers->>'surpriseDial')::numeric)
       or (p_answers->>'surpriseDial')::int < 1 or (p_answers->>'surpriseDial')::int > 5 then
      raise exception 'invalid surpriseDial' using errcode = '22023';
    end if;
    v_dial := (p_answers->>'surpriseDial')::int;
    v_epsilon := round((((v_dial - 1) / 4.0) * 0.3), 3);
  end if;

  -- CAS precheck.
  select profile_revision, onboarding_completed_at
    into v_existing_revision, v_prev_completed_at
  from public.user_travel_profiles
  where user_id = v_user_id;

  if v_existing_revision is not null and v_existing_revision <> p_expected_revision then
    raise exception 'stale profile revision' using errcode = '40001';
  end if;
  if v_existing_revision is null and p_expected_revision <> 0 then
    raise exception 'stale profile revision' using errcode = '40001';
  end if;

  -- Dealbreakers -- add-only (first-write onboarding; editing/removal is the /preferences editor).
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

    insert into public.user_travel_constraints
      (user_id, kind, flag, severity, source, created_by, confirmed_at)
    values
      (v_user_id, v_kind::public.trip_constraint_kind, v_flag, v_severity, 'manual', v_user_id, v_now)
    on conflict (user_id, kind, flag) where retired_at is null do nothing;
  end loop;

  -- Profile last.
  if v_existing_revision is null then
    insert into public.user_travel_profiles
      (user_id, onboarding_completed_at, serendipity_epsilon)
    values (v_user_id, v_now, coalesce(v_epsilon, 0.150))
    on conflict (user_id) do nothing
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  else
    update public.user_travel_profiles set
      onboarding_completed_at = v_now,
      serendipity_epsilon = case
        when v_epsilon is not null then v_epsilon
        when v_prev_completed_at is null then 0.150
        else public.user_travel_profiles.serendipity_epsilon
      end
    where user_id = v_user_id and profile_revision = p_expected_revision
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  end if;

  return v_new_revision;
end;
$$;

-- ===========================================================================================
-- 3. Organizer trip frame — broad mode, optional proposed budget + split permission, and a
--    planned duration for a frame that has no fixed dates yet (spec §2.3 / §3.3).
-- ===========================================================================================
create type public.trip_mode as enum ('relaxed', 'balanced', 'adventurous', 'mixed');

alter table public.trips
  add column trip_mode public.trip_mode,
  add column proposed_budget_tier public.budget_tier,
  add column split_allowed boolean not null default false,
  add column planned_duration_days int
    check (planned_duration_days is null or planned_duration_days between 1 and 14);

grant insert (trip_mode, proposed_budget_tier, split_allowed, planned_duration_days)
  on public.trips to authenticated;

-- trips_promote_when_ready (202609060002) still governs draft -> ready: a duration-only row
-- has null dates, so it stays draft until real dates are set. No trigger change needed.

-- create_trip_group: replace the name-only signature with the organizer frame. security
-- invoker -- the caller holds the trips insert grants and the permissive INSERT policy; the
-- trips_create_owner_membership AFTER INSERT trigger makes the owner membership atomic.
drop function public.create_trip_group(text);

create function public.create_trip_group(
  p_name text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_duration_days int,
  p_trip_mode text,
  p_proposed_budget_tier text,
  p_split_allowed boolean
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := public.ordinary_trim(coalesce(p_name, ''));
  v_dest text := public.ordinary_trim(coalesce(p_destination, ''));
  v_has_pair boolean := p_start_date is not null and p_end_date is not null;
  v_has_duration boolean := p_duration_days is not null;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'a group name is required (1-120 characters)' using errcode = '22023';
  end if;
  if char_length(v_dest) not between 1 and 120 then
    raise exception 'a destination is required (1-120 characters)' using errcode = '22023';
  end if;
  if p_trip_mode is null or p_trip_mode not in ('relaxed','balanced','adventurous','mixed') then
    raise exception 'invalid trip mode' using errcode = '22023';
  end if;
  if not v_has_pair and not v_has_duration then
    raise exception 'trip dates or a duration are required' using errcode = '22023';
  end if;
  if (p_start_date is null) <> (p_end_date is null) then
    raise exception 'provide both a start and an end date, or neither' using errcode = '22023';
  end if;
  if v_has_pair and (p_end_date < p_start_date or (p_end_date - p_start_date) > 13) then
    raise exception 'trip dates must be a 1-14 day range' using errcode = '22023';
  end if;
  if v_has_duration and p_duration_days not between 1 and 14 then
    raise exception 'duration must be 1-14 days' using errcode = '22023';
  end if;
  if p_proposed_budget_tier is not null
     and p_proposed_budget_tier not in ('budget','standard','premium','luxury') then
    raise exception 'invalid proposed budget tier' using errcode = '22023';
  end if;

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

-- ===========================================================================================
-- 4. trip_member_entries -- per-trip availability / budget / pace / safety overrides. Self-only
--    RLS; the aggregate summary is exposed only through a SECURITY DEFINER function (spec §6).
-- ===========================================================================================
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
-- Read is self-only. Writes must ALSO be for a trip the caller is currently a member of --
-- otherwise any authenticated user could inject their own entry into any known trip UUID and
-- skew (or force disclosure of) the aggregate summary. submit_member_entry re-checks the same
-- rule; these policies close the direct-PostgREST path.
create policy "self read" on public.trip_member_entries
  for select to authenticated using (user_id = auth.uid());
create policy "member self insert" on public.trip_member_entries
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy "member self update" on public.trip_member_entries
  for update to authenticated
  using (user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

create trigger trip_member_entries_set_updated_at before update on public.trip_member_entries
  for each row execute function public.set_updated_at();

comment on table public.trip_member_entries is
  'Per-trip member entry (availability, budget, pace, per-trip safety overrides). Self-only RLS. Aggregates only via public.trip_alignment_summary(uuid).';

-- ===========================================================================================
-- 5. submit_member_entry + trip_alignment_summary.
-- ===========================================================================================
create function public.submit_member_entry(p_trip_id uuid, p_entry jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_cov text := p_entry->'availability'->>'coverage';
  v_arr date;
  v_dep date;
  v_budget text := p_entry->>'budgetTier';
  v_pace text := p_entry->>'pace';
  v_over jsonb := coalesce(p_entry->'safetyOverrides', '[]'::jsonb);
  v_o jsonb;
  v_o_kind text;
  v_o_flag text;
  v_dietary text[] := array['halal','vegetarian','vegan','no_seafood','no_shellfish','no_pork','no_beef','no_dairy','no_gluten','no_peanut','other'];
  v_religious text[] := array['modest_dress_required','prayer_space_needed','no_alcohol_venues','other'];
  v_mobility text[] := array['wheelchair_accessible_required','limited_walking_distance','no_stairs','other'];
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = v_user) then
    raise exception 'not a member of this trip' using errcode = '42501';
  end if;
  if v_cov is null or v_cov not in ('full', 'partial') then
    raise exception 'invalid availability coverage' using errcode = '22023';
  end if;
  begin
    v_arr := nullif(p_entry->'availability'->>'arrivalDate', '')::date;
    v_dep := nullif(p_entry->'availability'->>'departureDate', '')::date;
  exception when others then
    raise exception 'invalid availability date' using errcode = '22023';
  end;
  if v_cov = 'partial' and v_arr is null and v_dep is null then
    raise exception 'partial availability needs a date' using errcode = '22023';
  end if;
  if v_arr is not null and v_dep is not null and v_dep < v_arr then
    raise exception 'departure is before arrival' using errcode = '22023';
  end if;
  if v_budget is null or v_budget not in ('budget','standard','premium','luxury') then
    raise exception 'invalid budget tier' using errcode = '22023';
  end if;
  if v_pace is null or v_pace not in ('relaxed','balanced','active','intense') then
    raise exception 'invalid pace' using errcode = '22023';
  end if;
  if jsonb_typeof(v_over) <> 'array' then
    raise exception 'safetyOverrides must be an array' using errcode = '22023';
  end if;
  -- Every override must name a real (kind, flag) from the typed vocabulary -- the RPC is
  -- directly callable, so the client-side whitelist is not enough. Arbitrary text must never
  -- reach the row or the aggregate summary.
  for v_o in select * from jsonb_array_elements(v_over) loop
    v_o_kind := v_o->>'kind';
    v_o_flag := v_o->>'flag';
    if v_o_kind not in ('dietary','religious_access','mobility') or v_o_flag is null then
      raise exception 'invalid safety override' using errcode = '22023';
    end if;
    if (v_o_kind = 'dietary' and not (v_o_flag = any(v_dietary)))
       or (v_o_kind = 'religious_access' and not (v_o_flag = any(v_religious)))
       or (v_o_kind = 'mobility' and not (v_o_flag = any(v_mobility))) then
      raise exception 'unknown safety override flag' using errcode = '22023';
    end if;
  end loop;

  insert into public.trip_member_entries
    (trip_id, user_id, availability_coverage, arrival_date, departure_date, budget_tier, pace, safety_overrides)
  values
    (p_trip_id, v_user, v_cov, v_arr, v_dep, v_budget::public.budget_tier, v_pace::public.pace_level, v_over)
  on conflict (trip_id, user_id) do update set
    availability_coverage = excluded.availability_coverage,
    arrival_date = excluded.arrival_date,
    departure_date = excluded.departure_date,
    budget_tier = excluded.budget_tier,
    pace = excluded.pace,
    safety_overrides = excluded.safety_overrides,
    updated_at = now();
end;
$$;
revoke all on function public.submit_member_entry(uuid, jsonb) from public, anon;
grant execute on function public.submit_member_entry(uuid, jsonb) to authenticated;

-- Aggregate, non-attributable (spec §2.4 / §6). SECURITY DEFINER so a member sees the shape
-- without RLS-reading peers' rows; returns null below the 2-entry de-anonymization floor.
-- Every entry counted is defensively joined back to a CURRENT trip_members row, so a stale
-- entry from a since-removed member (or one that predates the membership RLS fix) is ignored.
create function public.trip_alignment_summary(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb;
begin
  if v_caller is null
     or not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = v_caller) then
    raise exception 'not a member of this trip' using errcode = '42501';
  end if;

  with entries as (
    select e.availability_coverage, e.budget_tier, e.pace, e.safety_overrides
    from public.trip_member_entries e
    join public.trip_members m on m.trip_id = e.trip_id and m.user_id = e.user_id
    where e.trip_id = p_trip_id
  ),
  overrides as (
    select o->>'kind' as k, o->>'flag' as f
    from entries, jsonb_array_elements(entries.safety_overrides) o
  )
  select case when (select count(*) from entries) < 2 then null else jsonb_build_object(
    'memberCount', (select count(*)::int from entries),
    'budget', jsonb_build_object(
      'min', (select min(budget_tier)::text from entries),
      'max', (select max(budget_tier)::text from entries)),
    'pace', (select jsonb_object_agg(q.p, q.c) from (
      select x.p as p, count(e.*)::int as c
      from unnest(array['relaxed','balanced','active','intense']) as x(p)
      left join entries e on e.pace::text = x.p
      group by x.p) q),
    'availability', jsonb_build_object(
      'full', (select count(*)::int from entries where availability_coverage = 'full'),
      'partial', (select count(*)::int from entries where availability_coverage = 'partial')),
    'safetyOverrides', coalesce((select jsonb_agg(jsonb_build_object('kind', s.k, 'flag', s.f, 'count', s.c) order by s.k, s.f) from (
      select k, f, count(*)::int as c from overrides group by k, f) s), '[]'::jsonb)
  ) end
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.trip_alignment_summary(uuid) from public, anon;
grant execute on function public.trip_alignment_summary(uuid) to authenticated;
