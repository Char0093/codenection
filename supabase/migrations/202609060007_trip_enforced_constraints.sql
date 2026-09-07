-- The full hard-constraint set the Section VII gate evaluates for a trip (spec §3.2, revised
-- 2026-09-07): the UNION of every participating member's ACTIVE global confirmed constraints
-- (user_travel_constraints where retired_at is null and confirmed_at is not null) and the
-- trip's own ACTIVE confirmed constraints (trip_constraints where confirmed_at is not null).
-- Deduped per (kind, flag); severity is the strictest present (severe wins).
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
