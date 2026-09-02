create type public.itinerary_status as enum ('draft', 'proposed', 'active', 'archived');
create type public.proposal_status as enum ('pending', 'accepted', 'rejected', 'expired');
create type public.agent_job_status as enum ('queued', 'running', 'completed', 'failed');

create or replace function public.can_manage_trip(target_trip_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id
      and user_id = auth.uid()
      and role in ('owner', 'planner')
  );
$$;

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  provider_place_id text,
  name text not null,
  category text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  opening_hours jsonb not null default '{}'::jsonb,
  accessibility_features jsonb not null default '[]'::jsonb,
  dietary_options jsonb not null default '[]'::jsonb,
  allergens jsonb not null default '[]'::jsonb,
  halal_status text not null default 'not_applicable'
    check (halal_status in ('verified', 'not_verified', 'not_applicable')),
  indoor boolean not null default false,
  cost_tier public.budget_tier not null default 'standard',
  intensity public.pace_level not null default 'balanced',
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.constraints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_member_id uuid references public.trip_members(id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('preference', 'hard')),
  value jsonb not null default '{}'::jsonb,
  source text not null default 'profile' check (source in ('profile', 'web', 'telegram_confirmed')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  day_number int not null check (day_number > 0),
  status public.itinerary_status not null default 'draft',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, day_date),
  unique (trip_id, day_number)
);

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  job_type text not null,
  trigger_source text not null,
  status public.agent_job_status not null default 'queued',
  input_snapshot jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  agent_job_id uuid references public.agent_jobs(id) on delete set null,
  proposal_type text not null,
  status public.proposal_status not null default 'pending',
  title text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  requires_confirmation boolean not null default true,
  confirmed_by_member_id uuid references public.trip_members(id) on delete set null,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  itinerary_day_id uuid not null references public.itinerary_days(id) on delete cascade,
  destination_id uuid references public.destinations(id) on delete set null,
  agent_proposal_id uuid references public.agent_proposals(id) on delete set null,
  title text not null,
  item_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  travel_minutes int not null default 0 check (travel_minutes >= 0),
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  currency char(3) not null,
  score numeric(6,2),
  recommendation_reasons jsonb not null default '[]'::jsonb,
  safety_conflicts jsonb not null default '[]'::jsonb,
  fixed_commitment boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index destinations_trip_id_idx on public.destinations(trip_id);
create index constraints_trip_member_idx on public.constraints(trip_id, trip_member_id) where active;
create index itinerary_days_trip_date_idx on public.itinerary_days(trip_id, day_date);
create index itinerary_items_day_order_idx on public.itinerary_items(itinerary_day_id, sort_order);
create index agent_jobs_trip_status_idx on public.agent_jobs(trip_id, status, created_at desc);
create index agent_proposals_trip_status_idx on public.agent_proposals(trip_id, status, created_at desc);

create trigger destinations_set_updated_at before update on public.destinations
for each row execute function public.set_updated_at();
create trigger constraints_set_updated_at before update on public.constraints
for each row execute function public.set_updated_at();
create trigger itinerary_days_set_updated_at before update on public.itinerary_days
for each row execute function public.set_updated_at();
create trigger itinerary_items_set_updated_at before update on public.itinerary_items
for each row execute function public.set_updated_at();

alter table public.destinations enable row level security;
alter table public.constraints enable row level security;
alter table public.itinerary_days enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_proposals enable row level security;

create policy "members read destinations" on public.destinations for select
using (public.is_trip_member(trip_id));
create policy "planners manage destinations" on public.destinations for all
using (public.can_manage_trip(trip_id)) with check (public.can_manage_trip(trip_id));

create policy "members read consented constraints" on public.constraints for select
using (
  public.is_trip_member(trip_id)
  and (
    trip_member_id is null
    or exists (
      select 1 from public.trip_members tm
      where tm.id = constraints.trip_member_id and tm.consent_status = 'granted'
    )
  )
);
create policy "members manage own constraints" on public.constraints for all
using (
  exists (
    select 1 from public.trip_members tm
    where tm.id = constraints.trip_member_id
      and tm.trip_id = constraints.trip_id
      and tm.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.trip_members tm
    where tm.id = constraints.trip_member_id
      and tm.trip_id = constraints.trip_id
      and tm.user_id = auth.uid()
  )
);

create policy "members read itinerary days" on public.itinerary_days for select
using (public.is_trip_member(trip_id));
create policy "planners manage itinerary days" on public.itinerary_days for all
using (public.can_manage_trip(trip_id)) with check (public.can_manage_trip(trip_id));

create policy "members read itinerary items" on public.itinerary_items for select
using (
  exists (
    select 1 from public.itinerary_days day
    where day.id = itinerary_items.itinerary_day_id and public.is_trip_member(day.trip_id)
  )
);
create policy "planners manage itinerary items" on public.itinerary_items for all
using (
  exists (
    select 1 from public.itinerary_days day
    where day.id = itinerary_items.itinerary_day_id and public.can_manage_trip(day.trip_id)
  )
) with check (
  exists (
    select 1 from public.itinerary_days day
    where day.id = itinerary_items.itinerary_day_id and public.can_manage_trip(day.trip_id)
  )
);

create policy "members read agent jobs" on public.agent_jobs for select
using (trip_id is not null and public.is_trip_member(trip_id));

create policy "members read proposals" on public.agent_proposals for select
using (public.is_trip_member(trip_id));
create policy "planners review proposals" on public.agent_proposals for update
using (public.can_manage_trip(trip_id)) with check (public.can_manage_trip(trip_id));

comment on table public.agent_proposals is
  'Agent outputs are proposals. State-changing payloads require authorized confirmation and constraint revalidation.';
