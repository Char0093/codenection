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

-- Functions default to PUBLIC EXECUTE in PostgreSQL; these two are trigger-only helpers
-- that no role calls directly, so close them explicitly (repo convention: see 202609030004).
revoke all on function public.traveler_profiles_set_initial_revision() from public, anon, service_role;
revoke all on function public.traveler_profiles_bump_revision() from public, anon, service_role;

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
    if (p_answers->>'vibe') is null
       or (p_answers->>'vibe') not in ('heritage','food','nature','urban') then
      raise exception 'invalid vibe' using errcode = '22023';
    end if;
    if (p_answers->>'pace') is null
       or (p_answers->>'pace') not in ('relaxed','balanced','active','intense') then
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
      case when v_mode = 'full' then v_epsilon else 0.150 end
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
      serendipity_epsilon = case when v_prev_completed_at is null then 0.150
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

revoke all on function public._onboarding_check_flags(jsonb, text[]) from public, anon;
grant execute on function public._onboarding_check_flags(jsonb, text[]) to authenticated;
revoke all on function public.submit_onboarding(uuid, bigint, jsonb) from public, anon;
grant execute on function public.submit_onboarding(uuid, bigint, jsonb) to authenticated;
