create extension if not exists pgcrypto;

create type public.trip_role as enum ('owner', 'planner', 'member', 'viewer');
create type public.consent_status as enum ('pending', 'granted', 'revoked');
create type public.budget_tier as enum ('budget', 'standard', 'premium', 'luxury');
create type public.pace_level as enum ('relaxed', 'balanced', 'active', 'intense');
create type public.provider_status as enum ('ok', 'degraded', 'mocked', 'failed');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  destination_name text not null,
  destination_place_id text,
  start_date date not null,
  end_date date not null,
  budget_tier public.budget_tier not null default 'standard',
  pace public.pace_level not null default 'balanced',
  base_currency char(3) not null default 'USD',
  basecamp_label text,
  basecamp_lat numeric(10,7),
  basecamp_lng numeric(10,7),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  role public.trip_role not null default 'member',
  consent_status public.consent_status not null default 'pending',
  telegram_user_id text,
  home_currency char(3) not null default 'USD',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, user_id),
  unique (trip_id, telegram_user_id)
);

create table public.member_profiles (
  id uuid primary key default gen_random_uuid(),
  trip_member_id uuid not null unique references public.trip_members(id) on delete cascade,
  mobility_notes text,
  accessibility_requirements jsonb not null default '{}'::jsonb,
  chronic_health_notes text,
  sensory_sensitivities jsonb not null default '[]'::jsonb,
  severe_allergies jsonb not null default '[]'::jsonb,
  dietary_requirements jsonb not null default '[]'::jsonb,
  requires_halal boolean not null default false,
  language_code text not null default 'en',
  budget_tier public.budget_tier,
  pace public.pace_level,
  emergency_contact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  provider_name text not null,
  provider_kind text not null,
  status public.provider_status not null,
  request_fingerprint text,
  response_summary jsonb not null default '{}'::jsonb,
  error_message text,
  freshness_at timestamptz,
  created_at timestamptz not null default now()
);

create index trip_members_trip_id_idx on public.trip_members(trip_id);
create index trip_members_user_id_idx on public.trip_members(user_id);
create index provider_events_trip_provider_idx on public.provider_events(trip_id, provider_kind, created_at desc);

create or replace function public.is_trip_member(target_trip_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id and user_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.create_trip_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, display_name, role, consent_status)
  values (
    new.id,
    new.owner_user_id,
    coalesce(auth.jwt() ->> 'email', 'Trip owner'),
    'owner',
    'granted'
  );
  return new;
end;
$$;

create trigger trips_set_updated_at before update on public.trips for each row execute function public.set_updated_at();
create trigger trip_members_set_updated_at before update on public.trip_members for each row execute function public.set_updated_at();
create trigger member_profiles_set_updated_at before update on public.member_profiles for each row execute function public.set_updated_at();
create trigger trips_create_owner_membership after insert on public.trips for each row execute function public.create_trip_owner_membership();

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.member_profiles enable row level security;
alter table public.provider_events enable row level security;

create policy "members can read their trips" on public.trips for select using (public.is_trip_member(id));
create policy "authenticated users can create trips" on public.trips for insert to authenticated with check (owner_user_id = auth.uid());
create policy "owners and planners can update trips" on public.trips for update using (
  exists (select 1 from public.trip_members where trip_id = id and user_id = auth.uid() and role in ('owner', 'planner'))
);
create policy "members can read trip membership" on public.trip_members for select using (public.is_trip_member(trip_id));
create policy "owners and planners manage membership" on public.trip_members for all using (
  exists (select 1 from public.trip_members tm where tm.trip_id = trip_members.trip_id and tm.user_id = auth.uid() and tm.role in ('owner', 'planner'))
);
create policy "members can read consented profiles" on public.member_profiles for select using (
  exists (select 1 from public.trip_members tm where tm.id = member_profiles.trip_member_id and tm.consent_status = 'granted' and public.is_trip_member(tm.trip_id))
);
create policy "members update their own profile" on public.member_profiles for all using (
  exists (select 1 from public.trip_members tm where tm.id = member_profiles.trip_member_id and tm.user_id = auth.uid())
);
create policy "members can read provider events" on public.provider_events for select using (public.is_trip_member(trip_id));

comment on table public.member_profiles is 'Sensitive profile data. Only use for planning after explicit trip-member consent.';
