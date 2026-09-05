-- Implementation_Plan.md Task 1.1: traveler_profiles, poi_catalog, and the religious_access /
-- mobility slice of trip_constraints. Requires postgis (poi_catalog.geog) and vector
-- (traveler_profiles.interest_vector).
create extension if not exists postgis;
create extension if not exists vector;

-- ---------------------------------------------------------------------------------------------
-- trip_constraints: lift the dietary-only scope lock from 202609050002_dietary_constraints.sql.
-- religious_access and mobility get their own typed flag vocabularies, same shape as dietary's:
-- typed enum-like text checks, never free text. Section IX caps this at "an access and dress-code
-- flag" for religious matters and "a coarse mobility threshold the traveler sets themselves" --
-- these vocabularies are deliberately small and access-oriented, not diagnostic.
-- ---------------------------------------------------------------------------------------------
alter table public.trip_constraints drop constraint trip_constraints_kind_built;
alter table public.trip_constraints add constraint trip_constraints_religious_access_flag_valid check (
  kind <> 'religious_access' or flag in ('modest_dress_required', 'prayer_space_needed', 'no_alcohol_venues', 'other')
);
alter table public.trip_constraints add constraint trip_constraints_mobility_flag_valid check (
  kind <> 'mobility' or flag in ('wheelchair_accessible_required', 'limited_walking_distance', 'no_stairs', 'other')
);

-- ---------------------------------------------------------------------------------------------
-- traveler_profiles: the Section II-a / VI explicit preference baseline, one row per member.
-- social_role is private by design (Task 1.6): the SELECT policy below never grants any other
-- member -- including the trip owner -- a read of another member's row. An owner/planner may
-- write on a member's behalf (mirrors trip_constraints' on-behalf pattern) but that is a write
-- capability only; it does not imply read-back access.
-- ---------------------------------------------------------------------------------------------
create type public.traveler_social_role as enum ('navigator', 'chronicler', 'gourmand', 'go_with_the_flow', 'negotiator');

create table public.traveler_profiles (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_member_id uuid not null unique references public.trip_members(id) on delete cascade,
  interest_vector vector(64),
  budget_daily_cap numeric check (budget_daily_cap is null or budget_daily_cap >= 0),
  budget_total_cap numeric check (budget_total_cap is null or budget_total_cap >= 0),
  pace public.pace_level not null default 'balanced',
  mobility_threshold_m int check (mobility_threshold_m is null or mobility_threshold_m >= 0),
  serendipity_epsilon numeric not null default 0.2 check (serendipity_epsilon between 0.0 and 0.3),
  social_role public.traveler_social_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index traveler_profiles_trip_id_idx on public.traveler_profiles(trip_id);

alter table public.traveler_profiles enable row level security;
revoke all on public.traveler_profiles from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.traveler_profiles to authenticated;

-- Read: strictly self. Even an owner/planner reads nothing here for another member -- the
-- private social_role column has no separate carve-out to leak through.
create policy "members read their own traveler profile" on public.traveler_profiles
for select to authenticated using (
  exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
);

-- Write: self, or an owner/planner acting on a member's behalf (e.g. assisted onboarding).
create policy "members or managers write traveler profiles" on public.traveler_profiles
for insert to authenticated with check (
  exists (
    select 1 from public.trip_members tm
    where tm.id = trip_member_id and tm.trip_id = traveler_profiles.trip_id
  )
  and (
    exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
    or public.can_manage_trip(trip_id)
  )
);
create policy "members or managers update traveler profiles" on public.traveler_profiles
for update to authenticated using (
  exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
  or public.can_manage_trip(trip_id)
) with check (
  exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
  or public.can_manage_trip(trip_id)
);
create policy "members or managers delete traveler profiles" on public.traveler_profiles
for delete to authenticated using (
  exists (select 1 from public.trip_members tm where tm.id = trip_member_id and tm.user_id = auth.uid())
  or public.can_manage_trip(trip_id)
);

comment on table public.traveler_profiles is
  'Explicit preference baseline per Implementation_Plan.md Section II-a. social_role is private: RLS never returns another member''s row, including to the trip owner.';
comment on column public.traveler_profiles.social_role is
  'Private by design (Task 1.6). Read only by server-side jigsaw evaluation via a security-definer path added when that task lands -- never exposed through a client SELECT on this table.';

-- ---------------------------------------------------------------------------------------------
-- poi_catalog: shared reference data, not trip-scoped -- the same verified venue is reusable
-- across every trip. Read-only to ordinary users; only service_role (the seed script) writes it,
-- since this is curated ground-truth safety data, not user-generated trip content.
-- Provenance columns (source_url/source_note/verified_at) and allergen_data_unknown are additions
-- beyond Section VI's base column list, added per explicit instruction: every safety-critical
-- field must carry where it came from and when, and uncertain data must be marked unknown rather
-- than guessed.
-- ---------------------------------------------------------------------------------------------
create type public.poi_cost_tier as enum ('free', 'budget', 'standard', 'premium', 'luxury');
create type public.poi_halal_status as enum ('verified', 'claimed', 'unknown', 'no');
create type public.poi_dress_code as enum ('none', 'modest');
create type public.poi_tourist_density as enum ('low', 'medium', 'high');
create type public.poi_landmark_class as enum ('prominent_structure', 'global_storefront', 'architectural_typology');

create table public.poi_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(public.ordinary_trim(name)) between 1 and 200),
  region text not null,
  geog geography(Point, 4326) not null,
  cost_tier public.poi_cost_tier not null default 'standard',
  tags text[] not null default '{}',
  halal_status public.poi_halal_status not null default 'unknown',
  -- allergen_risk lists confirmed risky allergens; allergen_data_unknown says whether that list
  -- is authoritative. An empty array with allergen_data_unknown = true means "no data", not
  -- "confirmed safe" -- the gate (Section VII) must fail closed on the former for severe flags.
  allergen_risk text[] not null default '{}',
  allergen_data_unknown boolean not null default true,
  indoor boolean not null,
  dress_code public.poi_dress_code not null default 'none',
  tourist_density public.poi_tourist_density not null default 'medium',
  height_m numeric check (height_m is null or height_m >= 0),
  landmark_class public.poi_landmark_class,
  source_url text,
  source_note text,
  verified_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Natural key for the idempotent reference-corridor seed script: re-running it upserts by
  -- (name, region) rather than duplicating rows.
  unique (name, region)
);

create index poi_catalog_geog_idx on public.poi_catalog using gist(geog);
create index poi_catalog_region_idx on public.poi_catalog(region);

alter table public.poi_catalog enable row level security;
revoke all on public.poi_catalog from public, anon, authenticated, service_role;
grant select on public.poi_catalog to authenticated;

create policy "authenticated users read the poi catalog" on public.poi_catalog
for select to authenticated using (true);

comment on table public.poi_catalog is
  'Curated reference POIs per Implementation_Plan.md Section VI. Shared across trips, not trip-scoped. Written only by the seed script under service_role; ordinary users have read-only access.';
comment on column public.poi_catalog.allergen_data_unknown is
  'True means allergen_risk has no verified basis -- the hard-constraint gate (Section VII) must treat this as unknown, which fails closed for severe flags, not as "no allergens present".';
