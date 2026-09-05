-- Implementation_Plan.md Task 1.4: the hard-constraint gate's Budget/Mobility dimensions must be
-- checked "for ANY affected traveler" (Section VII), which means the proposal-generation flow --
-- run as a single acting member -- needs every member's numeric caps, not just its own.
--
-- traveler_profiles' own RLS (202609050006) is deliberately self-read-only to protect the private
-- social_role column, with no owner/planner carve-out, and that protection must not be loosened.
-- A plain view over the table would still be filtered by the caller's own row-level policy and so
-- would not help here. A security-definer function is the correct mechanism: it runs with the
-- function owner's privileges (bypassing the base table's per-row RLS) while enforcing its own
-- narrower authorization check (is_trip_member) and projecting only the four columns the gate
-- actually needs -- never social_role, pace, or interest_vector, which stay self-only.
create function public.trip_member_budget_mobility_caps(target_trip_id uuid)
returns table (trip_member_id uuid, budget_daily_cap numeric, budget_total_cap numeric, mobility_threshold_m int)
language sql stable security definer set search_path = '' as $$
  select tp.trip_member_id, tp.budget_daily_cap, tp.budget_total_cap, tp.mobility_threshold_m
  from public.traveler_profiles tp
  where tp.trip_id = target_trip_id and public.is_trip_member(target_trip_id);
$$;

revoke all on function public.trip_member_budget_mobility_caps(uuid) from public, anon, service_role;
grant execute on function public.trip_member_budget_mobility_caps(uuid) to authenticated;

comment on function public.trip_member_budget_mobility_caps(uuid) is
  'Group-wide read of only budget/mobility caps for the hard-constraint gate (Task 1.4). Deliberately excludes social_role, pace, interest_vector -- those stay self-only per traveler_profiles'' own RLS. Callable by any trip member, matching how trip_constraints is already group-readable for shared food-safety purposes.';
