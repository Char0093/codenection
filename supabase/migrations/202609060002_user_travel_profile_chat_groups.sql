-- First-login Travel DNA + trip chat groups, Task 2.
-- Global (per-user) Travel DNA + globally confirmed constraints + a submit RPC, plus
-- draft-trip state and a name-only create_trip_group RPC. Additive + relaxing only: nothing
-- is dropped, the delivered trip-scoped 202609060001 machinery stays intact, and the Task 3
-- backfill lands separately. See docs/superpowers/plans/2026-09-06-first-login-task2-subplan.md.

-- ===========================================================================================
-- 1. user_travel_profiles -- the global Travel DNA baseline, keyed on the user, self-only.
-- ===========================================================================================
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
  -- A completed profile must carry a budget lean and an on-grid dial -- same shape as
  -- 202609060001's traveler_profiles_completed_shape.
  constraint user_travel_profiles_completed_shape check (
    onboarding_completed_at is null
    or (budget_lean is not null and serendipity_epsilon in (0.0, 0.075, 0.15, 0.225, 0.3))
  )
);

create function public.user_travel_profiles_set_initial_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.profile_revision := 1;
  return new;
end;
$$;
revoke all on function public.user_travel_profiles_set_initial_revision() from public, anon, service_role;
create trigger user_travel_profiles_set_initial_revision
  before insert on public.user_travel_profiles
  for each row execute function public.user_travel_profiles_set_initial_revision();

create function public.user_travel_profiles_bump_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.profile_revision := old.profile_revision + 1;
  return new;
end;
$$;
revoke all on function public.user_travel_profiles_bump_revision() from public, anon, service_role;
create trigger user_travel_profiles_bump_revision
  before update on public.user_travel_profiles
  for each row execute function public.user_travel_profiles_bump_revision();

alter table public.user_travel_profiles enable row level security;
revoke all on public.user_travel_profiles from public, anon, authenticated, service_role;
grant select, delete on public.user_travel_profiles to authenticated;
-- profile_revision / created_at / updated_at are server-managed; user_id is insertable but
-- not updatable.
grant insert (user_id, travel_vibe, budget_lean, pace, social_role,
              serendipity_epsilon, mobility_threshold_m, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;
grant update (travel_vibe, budget_lean, pace, social_role,
              serendipity_epsilon, mobility_threshold_m, onboarding_completed_at)
  on public.user_travel_profiles to authenticated;

create policy "self read" on public.user_travel_profiles
  for select to authenticated using (user_id = auth.uid());
create policy "self insert" on public.user_travel_profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy "self update" on public.user_travel_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "self delete" on public.user_travel_profiles
  for delete to authenticated using (user_id = auth.uid());

comment on table public.user_travel_profiles is
  'Global per-user Travel DNA baseline (first-login onboarding). Self-only RLS: no other user, including any trip owner, can read another user''s row.';

-- ===========================================================================================
-- 2. user_travel_constraints -- globally confirmed typed requirements with a supersession
--    audit chain. Same typed vocabularies + severity rules as trip_constraints.
-- ===========================================================================================
create table public.user_travel_constraints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.trip_constraint_kind not null,
  flag text not null,
  severity public.trip_constraint_severity not null default 'standard',
  source public.trip_constraint_source not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  supersedes_id uuid references public.user_travel_constraints(id) on delete set null,
  retired_at timestamptz,
  constraint user_travel_constraints_dietary_flag_valid check (
    kind <> 'dietary' or flag in (
      'halal', 'vegetarian', 'vegan', 'no_seafood', 'no_shellfish',
      'no_pork', 'no_beef', 'no_dairy', 'no_gluten', 'no_peanut', 'other')),
  constraint user_travel_constraints_religious_flag_valid check (
    kind <> 'religious_access' or flag in (
      'modest_dress_required', 'prayer_space_needed', 'no_alcohol_venues', 'other')),
  constraint user_travel_constraints_mobility_flag_valid check (
    kind <> 'mobility' or flag in (
      'wheelchair_accessible_required', 'limited_walking_distance', 'no_stairs', 'other'))
);

-- At most one ACTIVE row per (user, kind, flag). An edit retires the old row and inserts a
-- replacement carrying supersedes_id in one transaction; removal retires without replacement.
create unique index user_travel_constraints_active_uniq
  on public.user_travel_constraints (user_id, kind, flag) where retired_at is null;
create index user_travel_constraints_user_idx on public.user_travel_constraints (user_id);

alter table public.user_travel_constraints enable row level security;
revoke all on public.user_travel_constraints from public, anon, authenticated, service_role;
grant select, insert on public.user_travel_constraints to authenticated;
-- No update/delete grant: supersession happens inside submit_user_onboarding this slice; the
-- /preferences editor (Task 5) adds a narrow update(retired_at) grant + policy.
create policy "self read" on public.user_travel_constraints
  for select to authenticated using (user_id = auth.uid());
create policy "self insert" on public.user_travel_constraints
  for insert to authenticated with check (user_id = auth.uid() and created_by = auth.uid());

-- Enforcement reads (Task 8 planning integration) go through this view, never the table.
-- security_invoker so it runs the caller's RLS, not the view owner's. No grant yet: nothing
-- reads it directly in this slice.
create view public.active_user_travel_constraints with (security_invoker = true) as
  select * from public.user_travel_constraints
  where retired_at is null and confirmed_at is not null;
revoke all on public.active_user_travel_constraints from public, anon, authenticated, service_role;

comment on table public.user_travel_constraints is
  'Globally confirmed typed requirements per user. Self-only RLS. Supersession: retire + insert with supersedes_id; at most one active row per (user, kind, flag).';

-- ===========================================================================================
-- 3. submit_user_onboarding -- one transaction: validate, add-only global dealbreakers,
--    profile upsert last. A near-copy of 202609060001's submit_onboarding minus the trip.
-- ===========================================================================================
create function public.submit_user_onboarding(p_expected_revision bigint, p_answers jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
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
  v_dietary text[] := array['halal','vegetarian','vegan','no_seafood','no_shellfish','no_pork','no_beef','no_dairy','no_gluten','no_peanut','other'];
  v_religious text[] := array['modest_dress_required','prayer_space_needed','no_alcohol_venues','other'];
  v_mobility text[] := array['wheelchair_accessible_required','limited_walking_distance','no_stairs','other'];
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Zod-independent input validation (the RPC is directly callable).
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
    if (p_answers->>'walkingCapM')::numeric <> trunc((p_answers->>'walkingCapM')::numeric)
       or (p_answers->>'walkingCapM')::numeric < 0
       or (p_answers->>'walkingCapM')::numeric > 50000 then
      raise exception 'walkingCapM out of range' using errcode = '22023';
    end if;
    v_cap := (p_answers->>'walkingCapM')::int;
  else
    v_cap := null;
  end if;

  if (p_answers->>'budgetLean') is null or (p_answers->>'budgetLean') not in ('budget','standard','premium','luxury') then
    raise exception 'invalid budgetLean' using errcode = '22023';
  end if;

  if v_mode = 'full' then
    if (p_answers->>'vibe') is null or (p_answers->>'vibe') not in ('heritage','food','nature','urban') then
      raise exception 'invalid vibe' using errcode = '22023';
    end if;
    if (p_answers->>'pace') is null or (p_answers->>'pace') not in ('relaxed','balanced','active','intense') then
      raise exception 'invalid pace' using errcode = '22023';
    end if;
    if (p_answers->>'socialRole') is null
       or (p_answers->>'socialRole') not in ('navigator','chronicler','gourmand','go_with_the_flow','negotiator') then
      raise exception 'invalid socialRole' using errcode = '22023';
    end if;
    if jsonb_typeof(p_answers->'surpriseDial') is distinct from 'number'
       or (p_answers->>'surpriseDial')::numeric <> trunc((p_answers->>'surpriseDial')::numeric)
       or (p_answers->>'surpriseDial')::int < 1 or (p_answers->>'surpriseDial')::int > 5 then
      raise exception 'invalid surpriseDial' using errcode = '22023';
    end if;
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

  -- Dealbreakers -- add-only (first-write onboarding; editing/removal is the Task 5 editor).
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
  if v_mode = 'full' then
    v_epsilon := round((((p_answers->>'surpriseDial')::int - 1) / 4.0) * 0.3, 3);
  end if;

  if v_existing_revision is null then
    insert into public.user_travel_profiles
      (user_id, budget_lean, mobility_threshold_m, onboarding_completed_at,
       travel_vibe, pace, social_role, serendipity_epsilon)
    values (
      v_user_id,
      (p_answers->>'budgetLean')::public.budget_tier,
      v_cap,
      v_now,
      case when v_mode = 'full' then (p_answers->>'vibe')::public.traveler_travel_vibe end,
      case when v_mode = 'full' then (p_answers->>'pace')::public.pace_level else 'balanced'::public.pace_level end,
      case when v_mode = 'full' then (p_answers->>'socialRole')::public.traveler_social_role end,
      case when v_mode = 'full' then v_epsilon else 0.150 end
    )
    on conflict (user_id) do nothing
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  elsif v_mode = 'full' then
    update public.user_travel_profiles set
      budget_lean = (p_answers->>'budgetLean')::public.budget_tier,
      mobility_threshold_m = v_cap,
      onboarding_completed_at = v_now,
      travel_vibe = (p_answers->>'vibe')::public.traveler_travel_vibe,
      pace = (p_answers->>'pace')::public.pace_level,
      social_role = (p_answers->>'socialRole')::public.traveler_social_role,
      serendipity_epsilon = v_epsilon
    where user_id = v_user_id and profile_revision = p_expected_revision
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  else
    update public.user_travel_profiles set
      budget_lean = (p_answers->>'budgetLean')::public.budget_tier,
      mobility_threshold_m = v_cap,
      onboarding_completed_at = v_now,
      serendipity_epsilon = case when v_prev_completed_at is null then 0.150
                                 else public.user_travel_profiles.serendipity_epsilon end
    where user_id = v_user_id and profile_revision = p_expected_revision
    returning profile_revision into v_new_revision;

    if v_new_revision is null then
      raise exception 'stale profile revision' using errcode = '40001';
    end if;
  end if;

  return v_new_revision;
end;
$$;

revoke all on function public.submit_user_onboarding(bigint, jsonb) from public, anon;
grant execute on function public.submit_user_onboarding(bigint, jsonb) to authenticated;

-- ===========================================================================================
-- 4. Draft trips -- a trip group can be created with a name only; destination + dates fill in
--    later and the row auto-promotes to `ready` (which generation/scheduling then require).
-- ===========================================================================================
create type public.trip_status as enum ('draft', 'ready');

-- Expand-compatible init: the column default fills every existing (complete) row with
-- `ready`; then the default flips so future inserts start `draft`.
alter table public.trips add column status public.trip_status not null default 'ready';
alter table public.trips alter column status set default 'draft';

-- One-way auto-promotion: a draft row with a real destination and a valid complete date range
-- becomes `ready`. Never demotes. Server-managed -- `status` is in no client grant.
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
  return new;
end;
$$;
revoke all on function public.trips_promote_when_ready() from public, anon, service_role;
create trigger trips_promote_when_ready before insert or update on public.trips
  for each row execute function public.trips_promote_when_ready();

-- Relax the NOT NULLs and swap the strict inline `end_date >= start_date` check for a
-- draft-aware one. The 202609030004 NOT VALID bounds checks stay -- each is NULL (passes) on a
-- null column.
alter table public.trips
  alter column destination_name drop not null,
  alter column start_date drop not null,
  alter column end_date drop not null;

-- The inline `check (end_date >= start_date)` from 202609020001 is the only unnamed
-- table-level check, so PostgreSQL named it `trips_check`. It is subsumed by
-- trips_ready_requires_setup (for ready rows) and trips_calendar_bounds (`end_date -
-- start_date between 0 and 13`, which still rejects an inverted range on a draft with both
-- dates set). Every other bounds check -- trips_calendar_bounds, trips_destination_bounds,
-- trips_notes_bounds -- is left exactly as it was.
alter table public.trips drop constraint if exists trips_check;

alter table public.trips add constraint trips_ready_requires_setup check (
  status = 'draft'
  or (destination_name is not null and public.ordinary_trim(destination_name) <> ''
      and start_date is not null and end_date is not null and end_date >= start_date)
);

-- create_trip_group: name-only draft group. security invoker -- the caller already holds the
-- insert(name, owner_user_id) grant and a permissive INSERT policy. The existing
-- trips_create_owner_membership AFTER INSERT trigger makes the owner membership atomic.
create function public.create_trip_group(p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := public.ordinary_trim(coalesce(p_name, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'a group name is required (1-120 characters)' using errcode = '22023';
  end if;
  insert into public.trips (name, owner_user_id) values (v_name, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_trip_group(text) from public, anon;
grant execute on function public.create_trip_group(text) to authenticated;

-- Generation gate (DB backstop; the UI gate is Task 6). Replace the two RPCs the app calls at
-- generation time with their current bodies + a `status = 'ready'` check that raises BEFORE
-- any reservation, quota check, or proposal insert. The dev_test@gmail.com exemption from
-- 202609050010 is preserved verbatim.
create or replace function public.reserve_generation(target_trip_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.trips t where t.id = target_trip_id) then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_trip(target_trip_id) then
    raise exception 'Owner or planner required' using errcode = '42501';
  end if;
  if (select t.status from public.trips t where t.id = target_trip_id) <> 'ready' then
    raise exception 'Trip setup is incomplete' using errcode = '22023';
  end if;
  -- Fixed user-then-trip order. Shared DB locks serialize counts with the insertion.
  perform pg_advisory_xact_lock(hashtextextended('generation:user:' || v_user::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('generation:trip:' || target_trip_id::text, 0));
  v_now := clock_timestamp();
  if coalesce(auth.jwt() ->> 'email', '') <> 'dev_test@gmail.com' then
    if (select count(*) from public.generation_reservations r
        where r.user_id = v_user and r.created_at > v_now - interval '1 hour') >= 5
      or (select count(*) from public.generation_reservations r
        where r.trip_id = target_trip_id and r.created_at > v_now - interval '10 minutes') >= 3 then
      raise exception 'Generation rate limit exceeded' using errcode = 'P0003';
    end if;
  end if;
  insert into public.generation_reservations(trip_id, user_id, created_at)
    values (target_trip_id, v_user, v_now);
end;
$$;

create or replace function public.save_trip_proposal(
  target_trip_id uuid, expected_revision bigint, proposal_payload jsonb, model_identifier text
) returns public.agent_proposals language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_proposal public.agent_proposals;
  v_validation jsonb;
  v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_trip from public.trips t where t.id = target_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if not public.can_manage_trip(target_trip_id) then
    raise exception 'Owner or planner required' using errcode = '42501';
  end if;
  if expected_revision is distinct from v_trip.revision then
    raise exception 'Trip revision changed' using errcode = '40001';
  end if;
  if v_trip.status <> 'ready' then
    raise exception 'Trip setup is incomplete' using errcode = '22023';
  end if;
  if save_trip_proposal.model_identifier is null
    or char_length(public.ordinary_trim(save_trip_proposal.model_identifier)) not between 1 and 200 then
    raise exception 'Invalid model identifier' using errcode = '22023';
  end if;
  v_validation := public.validate_trip_proposal(v_trip, proposal_payload);
  v_now := clock_timestamp();
  insert into public.agent_proposals(trip_id, proposal_type, status, title, summary, payload,
    model_identifier, validation_result, trip_revision, expires_at, created_at)
  values (target_trip_id, 'gemini_itinerary', 'pending', 'Generated itinerary', proposal_payload->>'summary',
    proposal_payload, save_trip_proposal.model_identifier, v_validation, v_trip.revision,
    v_now + interval '24 hours', v_now) returning * into v_proposal;
  return v_proposal;
end;
$$;
