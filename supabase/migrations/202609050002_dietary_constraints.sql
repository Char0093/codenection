-- Implementation_Plan.md Task 1.1 (dietary slice only). trip_constraints is the typed-enum
-- constraint store the plan specifies: kind + flag are typed, never free text, and a row is
-- inert until confirmed_at is set. religious_access and mobility are named in the kind enum for
-- forward compatibility with later Implementation_Plan.md tasks, but are not usable yet --
-- the flag allowlist and the kind check below restrict every row to 'dietary' until those
-- features land in a later migration.

create type public.trip_constraint_kind as enum ('dietary', 'religious_access', 'mobility');
create type public.trip_constraint_severity as enum ('severe', 'standard');
create type public.trip_constraint_source as enum ('chat', 'voice', 'social', 'manual');

create table public.trip_constraints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_member_id uuid not null references public.trip_members(id) on delete cascade,
  kind public.trip_constraint_kind not null,
  flag text not null,
  severity public.trip_constraint_severity not null default 'standard',
  source public.trip_constraint_source not null default 'manual',
  confirmed_by uuid references public.trip_members(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_member_id, kind, flag),
  -- Scope lock: only the dietary vocabulary is built. Drop and re-add this constraint when
  -- religious_access / mobility flags ship.
  constraint trip_constraints_kind_built check (kind = 'dietary'),
  constraint trip_constraints_dietary_flag_valid check (
    kind <> 'dietary' or flag in (
      'halal', 'vegetarian', 'vegan', 'no_seafood', 'no_shellfish',
      'no_pork', 'no_beef', 'no_dairy', 'no_gluten', 'no_peanut', 'other'
    )
  )
);

create index trip_constraints_trip_id_idx on public.trip_constraints(trip_id);
create index trip_constraints_trip_member_idx on public.trip_constraints(trip_member_id);

-- Enforcement (the Section VII hard-constraint gate) reads through this view so an
-- unconfirmed row can never be treated as active, per Task 1.1.
-- security_invoker: without it a view runs as its owner and would silently bypass the RLS
-- policies below, leaking every trip's constraints to any authenticated caller.
create view public.confirmed_trip_constraints
  with (security_invoker = true) as
  select * from public.trip_constraints where confirmed_at is not null;

create function public.bump_constraint_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.trips set revision = revision + 1 where id = old.trip_id;
    return old;
  end if;
  update public.trips set revision = revision + 1 where id = new.trip_id;
  return new;
end;
$$;
create trigger trip_constraints_bump_revision after insert or delete on public.trip_constraints
for each row execute function public.bump_constraint_revision();

alter table public.trip_constraints enable row level security;
revoke all on public.trip_constraints, public.confirmed_trip_constraints
  from public, anon, authenticated, service_role;
grant select, delete on public.trip_constraints to authenticated;
grant insert (trip_id, trip_member_id, kind, flag, severity, source, confirmed_by, confirmed_at)
  on public.trip_constraints to authenticated;
grant select on public.confirmed_trip_constraints to authenticated;

-- Read: any trip member sees the group's confirmed and pending dietary flags, since the whole
-- point is filtering shared options (restaurants, activities) for everyone at once.
create policy "trip members can read constraints" on public.trip_constraints
for select to authenticated using (public.is_trip_member(trip_id));

-- Write: a member sets their own flags (self-confirmed on tap), or an owner/planner sets flags
-- on a member's behalf -- but confirmed_by must always be the acting user's own membership row,
-- so an on-behalf confirmation is attributable per Implementation_Plan.md Task 1.3.
create policy "members set their own dietary constraints" on public.trip_constraints
for insert to authenticated with check (
  exists (
    select 1 from public.trip_members tm
    where tm.id = trip_member_id and tm.trip_id = trip_constraints.trip_id
  )
  and (
    exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
    or public.can_manage_trip(trip_id)
  )
  and exists (
    select 1 from public.trip_members tm
    where tm.id = confirmed_by and tm.trip_id = trip_constraints.trip_id and tm.user_id = auth.uid()
  )
);

create policy "members remove their own dietary constraints" on public.trip_constraints
for delete to authenticated using (
  exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
  or public.can_manage_trip(trip_id)
);

comment on table public.trip_constraints is
  'Typed hard/soft constraints per Implementation_Plan.md Section VII. Inert until confirmed_at is set; read enforcement through confirmed_trip_constraints, never this table directly.';
