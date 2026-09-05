-- Implementation_Plan.md Task 3.4 (POI choice pool + single-day builder). Three concerns:
--
-- 1. poi_catalog gains the columns the choice pool renders: a nullable provider Place ID used only
--    as a resolver key, an independently written short_description (WanderSync-owned prose, never a
--    relabelled provider description), an official_url, and a permitted, timestamped provider hours
--    snapshot. Owned safety evidence stays in the existing halal/allergen/source columns -- provider
--    content and owned content are deliberately separate columns so neither can masquerade as the
--    other (docs/features/provider-adapters.md).
-- 2. itinerary_items gains poi_id, so a block scheduled from the pool is linked to real catalog
--    safety data instead of being an unlinked Gemini string.
-- 3. Scheduling from the pool needs its own RPCs, and -- critically -- its own read path. The
--    existing SELECT policies only ever expose items belonging to an accepted, validated Gemini
--    proposal, so a pool-scheduled item would have been written and then been invisible to every
--    client. The policies below admit exactly the new case (a poi-linked item on the caller's own
--    trip) without widening the Gemini-provenance rule for anything else.

alter table public.poi_catalog
  -- Plain coordinates alongside geog. The pool's duplicate resolver runs in TypeScript and needs
  -- lat/lng over PostgREST; selecting `geog` directly would mean depending on PostGIS's
  -- serialization and on which schema the extension happens to live in (`public` locally,
  -- `extensions` on a hosted Supabase project). The seed script writes both from the same source
  -- coordinate, so these never drift from geog.
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists provider_place_id text,
  add column if not exists short_description text check (short_description is null or char_length(public.ordinary_trim(short_description)) between 1 and 500),
  add column if not exists official_url text,
  add column if not exists business_status text check (business_status is null or business_status in ('operational', 'closed_temporarily', 'closed_permanently')),
  add column if not exists provider_hours jsonb,
  add column if not exists provider_hours_fetched_at timestamptz,
  add column if not exists provider_hours_expires_at timestamptz;

create unique index if not exists poi_catalog_provider_place_id_idx on public.poi_catalog(provider_place_id)
  where provider_place_id is not null;

comment on column public.poi_catalog.provider_place_id is
  'Provider (Google Places) resolver key only. Never treat its presence as safety evidence.';
comment on column public.poi_catalog.short_description is
  'WanderSync-owned prose written from independently reviewable sources. Never a copied provider description.';
comment on column public.poi_catalog.provider_hours is
  'Permitted, timestamped provider opening-hours snapshot. NULL means unknown hours -- a warning, never evidence the venue is open.';

alter table public.itinerary_items
  add column if not exists poi_id uuid references public.poi_catalog(id) on delete set null;
create index if not exists itinerary_items_poi_idx on public.itinerary_items(poi_id) where poi_id is not null;

comment on column public.itinerary_items.poi_id is
  'Set when the block was scheduled from the POI choice pool. Unscheduling deletes this row, never the poi_catalog row.';

-- ---------------------------------------------------------------------------------------------
-- Read path for pool-scheduled items. Mirrors can_read_gemini_day's security-definer approach:
-- a narrow boolean that enforces membership itself, breaking the day -> item -> day policy cycle.
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_read_scheduled_day(target_day_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.itinerary_days d
    join public.itinerary_items i on i.itinerary_day_id = d.id
    where d.id = target_day_id and i.poi_id is not null and public.is_trip_member(d.trip_id)
      and i.local_date = d.day_date
      and i.local_start_time is not null and i.local_end_time is not null
  );
$$;

create or replace function public.can_schedule_on_day(target_day_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.itinerary_days d
    where d.id = target_day_id and public.is_trip_member(d.trip_id)
  );
$$;

drop policy if exists "members read pool-scheduled days" on public.itinerary_days;
create policy "members read pool-scheduled days" on public.itinerary_days
for select to authenticated using (public.can_read_scheduled_day(id));

drop policy if exists "members read pool-scheduled items" on public.itinerary_items;
create policy "members read pool-scheduled items" on public.itinerary_items
for select to authenticated using (
  poi_id is not null
  and local_date is not null and local_start_time is not null and local_end_time is not null
  and public.can_schedule_on_day(itinerary_day_id)
);

revoke all on function public.can_read_scheduled_day(uuid), public.can_schedule_on_day(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_scheduled_day(uuid), public.can_schedule_on_day(uuid) to authenticated;

-- 202609030004 deliberately grants SELECT on itinerary_items column by column, keeping legacy
-- profile-bearing columns (safety_conflicts, destination_id) outside the client's read surface --
-- `select *` is denied on purpose. poi_id has to join that allow-list explicitly or the pool policy
-- above would be unreachable; nothing else about the narrowed surface changes, and mutations still
-- go exclusively through the security-definer RPCs.
grant select (poi_id) on public.itinerary_items to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Scheduling a pool POI. Same validation set as reorder_itinerary_item -- membership, revision,
-- trip date range, 15-480 minute domain, midnight, overlap -- so a dropped card can never produce
-- a schedule the drag path itself would have refused. Opening-hours feasibility is decided by
-- lib/poi/opening-hours.ts before the drop and revalidated by the caller; the provider snapshot is
-- deliberately not re-derived here, because a stale snapshot must never silently harden into a
-- database-level claim that a venue was open.
-- ---------------------------------------------------------------------------------------------
create or replace function public.schedule_poi_item(
  target_trip_id uuid, target_poi_id uuid, expected_revision bigint,
  new_local_date date, new_local_start_time time without time zone,
  new_duration_minutes int, new_item_type text
) returns public.itinerary_items language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_poi public.poi_catalog;
  v_day public.itinerary_days;
  v_duration interval;
  v_new_end_ts timestamp;
  v_new_end time without time zone;
  v_conflict boolean;
  v_item public.itinerary_items;
  v_order int;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if new_duration_minutes not between 15 and 480 then
    raise exception 'Duration must be between 15 and 480 minutes' using errcode = '22023';
  end if;
  if new_item_type not in ('culture', 'food', 'nature', 'shopping', 'transit') then
    raise exception 'Unsupported activity category' using errcode = '22023';
  end if;
  select * into v_trip from public.trips t where t.id = target_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if not public.is_trip_member(target_trip_id) then
    raise exception 'Trip membership required' using errcode = '42501';
  end if;
  if expected_revision is distinct from v_trip.revision then
    raise exception 'Trip revision changed' using errcode = '40001';
  end if;
  if new_local_date < v_trip.start_date or new_local_date > v_trip.end_date then
    raise exception 'Date is outside the trip range' using errcode = '22023';
  end if;

  select * into v_poi from public.poi_catalog p where p.id = target_poi_id;
  if not found then raise exception 'Place not found' using errcode = 'P0002'; end if;
  if v_poi.business_status in ('closed_permanently', 'closed_temporarily') then
    raise exception 'This place is reported closed and cannot be scheduled' using errcode = '23514';
  end if;

  select d.* into v_day from public.itinerary_days d
    where d.trip_id = target_trip_id and d.day_date = new_local_date;
  if not found then raise exception 'Target day not found' using errcode = 'P0002'; end if;

  v_duration := make_interval(mins => new_duration_minutes);
  v_new_end_ts := (new_local_date::timestamp + new_local_start_time) + v_duration;
  if v_new_end_ts::date > new_local_date then
    raise exception 'Activity would cross midnight' using errcode = '22023';
  end if;
  v_new_end := v_new_end_ts::time;

  select exists (
    select 1 from public.itinerary_items other
    where other.itinerary_day_id = v_day.id
      and other.local_start_time is not null and other.local_end_time is not null
      and new_local_start_time < other.local_end_time and v_new_end > other.local_start_time
  ) into v_conflict;
  if v_conflict then raise exception 'Overlaps another activity that day' using errcode = '23514'; end if;

  select coalesce(max(i.sort_order), -1) + 1 into v_order
    from public.itinerary_items i where i.itinerary_day_id = v_day.id;

  insert into public.itinerary_items(
    itinerary_day_id, poi_id, title, item_type, starts_at, ends_at,
    local_date, local_start_time, local_end_time, currency, sort_order)
  values (
    v_day.id, v_poi.id, v_poi.name, new_item_type,
    (new_local_date::timestamp + new_local_start_time) at time zone 'UTC',
    v_new_end_ts at time zone 'UTC',
    new_local_date, new_local_start_time, v_new_end, v_trip.base_currency, v_order)
  returning * into v_item;

  update public.trips set revision = revision + 1 where id = target_trip_id;
  return v_item;
end;
$$;

-- Returning the POI to the pool. Only pool-scheduled items can be unscheduled: a Gemini-authored
-- block has no catalog row to return to, so it is edited or rejected through the proposal flow
-- instead. The poi_catalog row is never touched.
create or replace function public.unschedule_itinerary_item(
  target_trip_id uuid, target_item_id uuid, expected_revision bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_item public.itinerary_items;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_trip from public.trips t where t.id = target_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if not public.is_trip_member(target_trip_id) then
    raise exception 'Trip membership required' using errcode = '42501';
  end if;
  if expected_revision is distinct from v_trip.revision then
    raise exception 'Trip revision changed' using errcode = '40001';
  end if;

  select i.* into v_item from public.itinerary_items i
    join public.itinerary_days d on d.id = i.itinerary_day_id
    where i.id = target_item_id and d.trip_id = target_trip_id for update;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  if v_item.poi_id is null then
    raise exception 'Only a place scheduled from the pool can be returned to it' using errcode = '23514';
  end if;
  if v_item.fixed_commitment then
    raise exception 'Fixed reservations must be unlocked before they can be unscheduled' using errcode = '23514';
  end if;

  delete from public.itinerary_items where id = v_item.id;
  update public.trips set revision = revision + 1 where id = target_trip_id;
  return v_item.poi_id;
end;
$$;

revoke all on function public.schedule_poi_item(uuid, uuid, bigint, date, time without time zone, int, text) from public, anon, service_role;
grant execute on function public.schedule_poi_item(uuid, uuid, bigint, date, time without time zone, int, text) to authenticated;
revoke all on function public.unschedule_itinerary_item(uuid, uuid, bigint) from public, anon, service_role;
grant execute on function public.unschedule_itinerary_item(uuid, uuid, bigint) to authenticated;
