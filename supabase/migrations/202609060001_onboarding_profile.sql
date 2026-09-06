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
