-- Forward-only scope reduction. Retired tables and their historical data remain intact.
revoke all on public.member_profiles, public.constraints, public.destinations,
  public.provider_events, public.agent_jobs from public, anon, authenticated, service_role;

drop policy "owners and planners manage membership" on public.trip_members;
drop policy "owners and planners can update trips" on public.trips;
drop policy "planners manage itinerary days" on public.itinerary_days;
drop policy "planners manage itinerary items" on public.itinerary_items;
drop policy "planners review proposals" on public.agent_proposals;
drop policy "members read proposals" on public.agent_proposals;
drop policy "members read itinerary days" on public.itinerary_days;
drop policy "members read itinerary items" on public.itinerary_items;

-- ECMAScript String.trim whitespace, explicitly enumerated to avoid locale-dependent
-- PostgreSQL regex classes. U+0085 and U+200B are deliberately not JS whitespace.
create function public.ordinary_trim(value text)
returns text language sql immutable strict parallel safe set search_path = '' as $$
  select pg_catalog.btrim(value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

-- These helpers bypass membership RLS without querying the policy recursively.
create or replace function public.is_trip_member(target_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.trip_members tm
    where tm.trip_id = target_trip_id and tm.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_trip(target_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.trips t
    where t.id = target_trip_id and (
      t.owner_user_id = auth.uid() or exists (
        select 1 from public.trip_members tm
        where tm.trip_id = t.id and tm.user_id = auth.uid() and tm.role = 'planner'
      )
    )
  );
$$;

create policy "owners and planners edit trip inputs" on public.trips
for update to authenticated using (public.can_manage_trip(trips.id))
with check (public.can_manage_trip(trips.id));

alter table public.trips add column revision bigint not null default 1 check (revision >= 1);
-- Preserve legacy rows; PostgreSQL still checks every newly inserted/updated row.
alter table public.trips
  add constraint trips_destination_bounds check (
    char_length(public.ordinary_trim(destination_name)) between 1 and 120
  ) not valid,
  add constraint trips_notes_bounds check (notes is null or char_length(public.ordinary_trim(notes)) <= 1000) not valid,
  add constraint trips_calendar_bounds check (
    start_date between date '0001-01-01' and date '9999-12-31'
    and end_date between date '0001-01-01' and date '9999-12-31'
    and end_date - start_date between 0 and 13
  ) not valid;
alter table public.agent_proposals
  add column model_identifier text,
  add column validation_result jsonb,
  add column trip_revision bigint;

-- Nullable during trip creation; the composite FK also prevents cross-trip pointers.
alter table public.agent_proposals add constraint agent_proposals_trip_id_id_key unique (trip_id, id);
alter table public.trips add column active_proposal_id uuid;
alter table public.trips add constraint trips_active_proposal_fk
  foreign key (id, active_proposal_id) references public.agent_proposals(trip_id, id);

create function public.bump_trip_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.name, new.destination_name, new.destination_place_id, new.start_date,
    new.end_date, new.budget_tier, new.pace, new.base_currency, new.basecamp_label,
    new.basecamp_lat, new.basecamp_lng, new.notes)
    is distinct from
    row(old.name, old.destination_name, old.destination_place_id, old.start_date,
    old.end_date, old.budget_tier, old.pace, old.base_currency, old.basecamp_label,
    old.basecamp_lat, old.basecamp_lng, old.notes) then
    new.revision := old.revision + 1;
  end if;
  -- Active proposal is historical state and deliberately survives changed inputs.
  return new;
end;
$$;
create trigger trips_bump_revision before update on public.trips
for each row execute function public.bump_trip_revision();

revoke all on public.trips, public.trip_members, public.agent_proposals,
  public.itinerary_days, public.itinerary_items from public, anon, authenticated, service_role;
grant select on public.trips, public.trip_members, public.agent_proposals,
  public.itinerary_days to authenticated;
grant insert (name, owner_user_id, destination_name, start_date, end_date, budget_tier, pace, notes)
  on public.trips to authenticated;
grant update (destination_name, start_date, end_date, budget_tier, pace, notes)
  on public.trips to authenticated;

create table public.trip_preferences (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null check (kind in ('interest', 'pace', 'budget')),
  value text not null check (char_length(public.ordinary_trim(value)) between 1 and 500),
  confirmed_by uuid not null references public.trip_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trip_preferences_trip_idx on public.trip_preferences(trip_id);
alter table public.trip_preferences enable row level security;
revoke all on public.trip_preferences from public, anon, authenticated, service_role;
grant select, delete on public.trip_preferences to authenticated;
grant insert (trip_id, kind, value, confirmed_by) on public.trip_preferences to authenticated;
grant update (kind, value, confirmed_by) on public.trip_preferences to authenticated;
create policy "members read ordinary preferences" on public.trip_preferences
for select to authenticated using (public.is_trip_member(trip_id));
create policy "planners insert confirmed ordinary preferences" on public.trip_preferences
for insert to authenticated with check (
  public.can_manage_trip(trip_id) and exists (
    select 1 from public.trip_members tm where tm.id = trip_preferences.confirmed_by
      and tm.trip_id = trip_preferences.trip_id and tm.user_id = auth.uid()
  )
);
create policy "planners update confirmed ordinary preferences" on public.trip_preferences
for update to authenticated using (public.can_manage_trip(trip_id)) with check (
  public.can_manage_trip(trip_id) and exists (
    select 1 from public.trip_members tm where tm.id = trip_preferences.confirmed_by
      and tm.trip_id = trip_preferences.trip_id and tm.user_id = auth.uid()
  )
);
create policy "planners delete ordinary preferences" on public.trip_preferences
for delete to authenticated using (public.can_manage_trip(trip_id));
create trigger trip_preferences_set_updated_at before update on public.trip_preferences
for each row execute function public.set_updated_at();

create function public.bump_preference_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.kind, new.value, new.confirmed_by) is not distinct from
      row(old.kind, old.value, old.confirmed_by) then return new; end if;
  end if;
  -- This update takes the same trip lock as save/decide, serializing input changes.
  if tg_op = 'DELETE' then
    update public.trips set revision = revision + 1 where id = old.trip_id;
    return old;
  end if;
  update public.trips set revision = revision + 1 where id = new.trip_id;
  return new;
end;
$$;
create trigger trip_preferences_bump_revision after insert or update or delete on public.trip_preferences
for each row execute function public.bump_preference_revision();

-- Existing timestamps are kept for compatibility. New fields express wall-clock intent.
alter table public.itinerary_items
  add column local_date date,
  add column local_start_time time without time zone,
  add column local_end_time time without time zone;
comment on column public.itinerary_items.starts_at is
  'For Gemini itineraries: activity.date + activity.startTime interpreted at UTC as a local wall-clock placeholder, NOT a timezone conversion. UI uses raw activity.date/startTime or local_date/local_start_time. Legacy rows retain their original semantics.';
comment on column public.itinerary_items.ends_at is
  'For Gemini itineraries: UTC placeholder of local date/time plus duration; not the actual destination instant.';
comment on column public.itinerary_items.local_date is
  'Local activity date for new Gemini itineraries. Nullable for historical rows whose timezone semantics are unknown.';

-- Legacy destination/profile-conflict columns are outside the narrowed read surface.
grant select (id, itinerary_day_id, agent_proposal_id, title, item_type, starts_at, ends_at,
  travel_minutes, estimated_cost, currency, score, recommendation_reasons,
  fixed_commitment, sort_order, created_at, updated_at, local_date, local_start_time, local_end_time)
  on public.itinerary_items to authenticated;

create function public.is_validated_gemini_proposal(target_proposal public.agent_proposals)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(
    target_proposal.proposal_type = 'gemini_itinerary'
    and target_proposal.trip_revision >= 1
    and char_length(public.ordinary_trim(target_proposal.model_identifier)) between 1 and 200
    and target_proposal.validation_result @> '{"valid":true,"validatorVersion":1}'::jsonb,
    false
  );
$$;

create policy "members read validated Gemini proposals" on public.agent_proposals
for select to authenticated using (
  public.is_trip_member(trip_id) and public.is_validated_gemini_proposal(agent_proposals)
);

-- This narrow boolean helper bypasses item/day RLS to break the day -> item -> day
-- policy cycle. It enforces membership and provenance itself, returning no row data.
create function public.can_read_gemini_day(target_day_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.itinerary_days d
    join public.itinerary_items i on i.itinerary_day_id = d.id
    join public.agent_proposals p on p.id = i.agent_proposal_id and p.trip_id = d.trip_id
    where d.id = target_day_id and public.is_trip_member(d.trip_id)
      and public.is_validated_gemini_proposal(p) and p.status = 'accepted'
      and i.local_date = d.day_date
      and i.local_start_time is not null and i.local_end_time is not null
  );
$$;

create policy "members read validated Gemini days" on public.itinerary_days
for select to authenticated using (public.can_read_gemini_day(id));

create policy "members read validated Gemini items" on public.itinerary_items
for select to authenticated using (
  local_date is not null and local_start_time is not null and local_end_time is not null
  and exists (
    select 1 from public.itinerary_days d
    join public.agent_proposals p on p.trip_id = d.trip_id
    where d.id = itinerary_items.itinerary_day_id and p.id = itinerary_items.agent_proposal_id
      and p.status = 'accepted' and itinerary_items.local_date = d.day_date
      -- Proposal RLS checks the validation markers; day RLS checks membership.
  )
);

-- Internal validator has no client EXECUTE grant. Both public RPCs invoke it.
create function public.validate_trip_proposal(target_trip public.trips, proposal_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a jsonb;
  v_date date;
  v_minutes integer;
  v_start integer;
  v_cap integer;
  v_days integer := target_trip.end_date - target_trip.start_date + 1;
  v_seen_dates date[] := '{}';
  v_day date;
  v_total integer;
  v_previous_end integer;
  v_budget_rank integer;
begin
  if v_days < 1 or v_days > 14 then
    raise exception 'Trip must cover 1 to 14 days' using errcode = '22023';
  end if;
  if jsonb_typeof(proposal_payload) is distinct from 'object'
    or octet_length(proposal_payload::text) > 262144 then
    raise exception 'Invalid proposal envelope' using errcode = '22023';
  end if;
  if not (proposal_payload ?& array['summary', 'activities', 'assumptions'])
    or exists (select 1 from jsonb_object_keys(proposal_payload) k
      where k not in ('summary', 'activities', 'assumptions'))
    or jsonb_typeof(proposal_payload->'summary') is distinct from 'string'
    or char_length(public.ordinary_trim(proposal_payload->>'summary')) not between 1 and 2000
    or jsonb_typeof(proposal_payload->'activities') is distinct from 'array'
    or jsonb_typeof(proposal_payload->'assumptions') is distinct from 'array' then
    raise exception 'Invalid proposal fields' using errcode = '22023';
  end if;
  if jsonb_array_length(proposal_payload->'activities') not between 1 and 336
    or jsonb_array_length(proposal_payload->'assumptions') > 30 then
    raise exception 'Invalid proposal array size' using errcode = '22023';
  end if;
  for a in select value from jsonb_array_elements(proposal_payload->'assumptions') loop
    if jsonb_typeof(a) is distinct from 'string' or char_length(public.ordinary_trim(a #>> '{}')) not between 1 and 1000 then
      raise exception 'Invalid assumption' using errcode = '22023';
    end if;
  end loop;
  v_cap := case target_trip.pace when 'relaxed' then 240 when 'balanced' then 360
    when 'active' then 480 when 'intense' then 600 end;
  v_budget_rank := array_position(array['budget', 'standard', 'premium', 'luxury'], target_trip.budget_tier::text);

  for a in select value from jsonb_array_elements(proposal_payload->'activities') loop
    if jsonb_typeof(a) is distinct from 'object' then
      raise exception 'Invalid activity object' using errcode = '22023';
    end if;
    if not (a ?& array['title','date','category','startTime','durationMinutes','estimatedCostTier','rationale','contingencyNote'])
      or exists (select 1 from jsonb_object_keys(a) k where k not in
        ('title','date','category','startTime','durationMinutes','estimatedCostTier','rationale','contingencyNote')) then
      raise exception 'Invalid activity fields' using errcode = '22023';
    end if;
    if jsonb_typeof(a->'title') is distinct from 'string'
      or char_length(public.ordinary_trim(a->>'title')) not between 1 and 200
      or jsonb_typeof(a->'rationale') is distinct from 'string'
      or char_length(public.ordinary_trim(a->>'rationale')) not between 1 and 1000
      or (jsonb_typeof(a->'contingencyNote') is distinct from 'null' and
        (jsonb_typeof(a->'contingencyNote') is distinct from 'string'
          or char_length(public.ordinary_trim(a->>'contingencyNote')) not between 1 and 1000))
      or jsonb_typeof(a->'category') is distinct from 'string'
      or a->>'category' not in ('culture','food','nature','shopping','transit') then
      raise exception 'Invalid activity text or category' using errcode = '22023';
    end if;
    if jsonb_typeof(a->'date') is distinct from 'string'
      or (a->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(a->'startTime') is distinct from 'string'
      or (a->>'startTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(a->'durationMinutes') is distinct from 'number' then
      raise exception 'Invalid activity date, time or duration' using errcode = '22023';
    end if;
    begin
      v_date := (a->>'date')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'Invalid activity date' using errcode = '22023';
    end;
    if v_date < target_trip.start_date or v_date > target_trip.end_date
      or (a->>'durationMinutes')::numeric <> trunc((a->>'durationMinutes')::numeric)
      or (a->>'durationMinutes')::numeric not between 15 and 480 then
      raise exception 'Activity outside trip dates or duration bounds' using errcode = '22023';
    end if;
    v_minutes := (a->>'durationMinutes')::numeric::integer;
    v_start := substring(a->>'startTime',1,2)::integer * 60 + substring(a->>'startTime',4,2)::integer;
    if v_start + v_minutes > 1440 then
      raise exception 'Activity crosses midnight' using errcode = '22023';
    end if;
    if jsonb_typeof(a->'estimatedCostTier') is distinct from 'string'
      or a->>'estimatedCostTier' not in ('budget','standard','premium','luxury')
      or array_position(array['budget','standard','premium','luxury'], a->>'estimatedCostTier') > v_budget_rank then
      raise exception 'Activity exceeds budget tier cap' using errcode = '22023';
    end if;
    if not (v_date = any(v_seen_dates)) then v_seen_dates := array_append(v_seen_dates, v_date); end if;
  end loop;
  if cardinality(v_seen_dates) <> v_days then
    raise exception 'Every trip day requires an activity' using errcode = '22023';
  end if;
  foreach v_day in array v_seen_dates loop
    v_total := 0;
    v_previous_end := 0;
    for a in select value from jsonb_array_elements(proposal_payload->'activities')
      where (value->>'date')::date = v_day order by value->>'startTime' loop
      v_minutes := (a->>'durationMinutes')::numeric::integer;
      v_start := substring(a->>'startTime',1,2)::integer * 60 + substring(a->>'startTime',4,2)::integer;
      if v_start < v_previous_end then
        raise exception 'Activities overlap' using errcode = '22023';
      end if;
      v_previous_end := v_start + v_minutes;
      v_total := v_total + v_minutes;
    end loop;
    if v_total > v_cap then
      raise exception 'Daily duration exceeds pace cap' using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('valid', true, 'validatorVersion', 1, 'days', v_days,
    'dailyMinutesCap', v_cap, 'budgetTierCap', target_trip.budget_tier);
end;
$$;

create function public.save_trip_proposal(
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

create function public.decide_trip_proposal(target_trip_id uuid, target_proposal_id uuid, decision text)
returns public.agent_proposals language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_proposal public.agent_proposals;
  v_validation jsonb;
  v_day date;
  v_day_id uuid;
  v_member uuid;
  a jsonb;
  v_start timestamp without time zone;
  v_end timestamp without time zone;
  v_order integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if decision is null or decision not in ('accept', 'reject') then
    raise exception 'Decision must be accept or reject' using errcode = '22023';
  end if;
  -- Global lock order: trip, then proposal. Save and input updates share this trip lock.
  select * into v_trip from public.trips t where t.id = target_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if v_trip.owner_user_id <> auth.uid() then
    raise exception 'Only the trip owner can decide' using errcode = '42501';
  end if;
  select * into v_proposal from public.agent_proposals p
    where p.trip_id = target_trip_id and p.id = target_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  -- Both accept and reject return the row, so neither may disclose legacy payloads.
  if not public.is_validated_gemini_proposal(v_proposal) then
    raise exception 'Unsupported proposal' using errcode = '22023';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'Only pending proposals can be decided' using errcode = '40001';
  end if;
  if decision = 'reject' then
    update public.agent_proposals set status = 'rejected', rejected_at = clock_timestamp()
      where id = v_proposal.id returning * into v_proposal;
    return v_proposal;
  end if;
  if v_proposal.expires_at is null or v_proposal.expires_at <= clock_timestamp() then
    raise exception 'Proposal expired' using errcode = '40001';
  end if;
  if v_proposal.trip_revision is distinct from v_trip.revision then
    raise exception 'Trip revision changed' using errcode = '40001';
  end if;
  v_validation := public.validate_trip_proposal(v_trip, v_proposal.payload);
  select tm.id into v_member from public.trip_members tm
    where tm.trip_id = target_trip_id and tm.user_id = auth.uid();
  if v_member is null then raise exception 'Owner membership required' using errcode = '42501'; end if;

  delete from public.itinerary_days where trip_id = target_trip_id;
  for v_day in select distinct (value->>'date')::date
    from jsonb_array_elements(v_proposal.payload->'activities') order by 1 loop
    insert into public.itinerary_days(trip_id, day_date, day_number, status, summary)
      values (target_trip_id, v_day, v_day - v_trip.start_date + 1, 'active', v_proposal.summary)
      returning id into v_day_id;
    v_order := 0;
    for a in select value from jsonb_array_elements(v_proposal.payload->'activities')
      where (value->>'date')::date = v_day order by value->>'startTime' loop
      v_start := v_day + (a->>'startTime')::time;
      v_end := v_start + make_interval(mins => (a->>'durationMinutes')::numeric::integer);
      insert into public.itinerary_items(itinerary_day_id, agent_proposal_id, title, item_type,
        starts_at, ends_at, local_date, local_start_time, local_end_time, currency,
        recommendation_reasons, sort_order)
      values (v_day_id, v_proposal.id, a->>'title', a->>'category',
        v_start at time zone 'UTC', v_end at time zone 'UTC', v_day, v_start::time,
        case when v_end::date > v_day then time '24:00' else v_end::time end,
        v_trip.base_currency, jsonb_build_array(a->>'rationale'), v_order);
      v_order := v_order + 1;
    end loop;
  end loop;
  update public.agent_proposals set status = 'accepted', confirmed_by_member_id = v_member,
    confirmed_at = clock_timestamp(), validation_result = v_validation
    where id = v_proposal.id returning * into v_proposal;
  update public.agent_proposals set status = 'expired'
    where trip_id = target_trip_id and id <> v_proposal.id and status = 'pending';
  update public.trips set active_proposal_id = v_proposal.id where id = target_trip_id;
  return v_proposal;
end;
$$;

create table public.generation_reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index generation_reservations_user_time_idx on public.generation_reservations(user_id, created_at);
create index generation_reservations_trip_time_idx on public.generation_reservations(trip_id, created_at);
alter table public.generation_reservations enable row level security;
revoke all on public.generation_reservations from public, anon, authenticated, service_role;

create function public.reserve_generation(target_trip_id uuid)
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
  -- Fixed user-then-trip order. Shared DB locks serialize counts with the insertion.
  perform pg_advisory_xact_lock(hashtextextended('generation:user:' || v_user::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('generation:trip:' || target_trip_id::text, 0));
  v_now := clock_timestamp();
  if (select count(*) from public.generation_reservations r
      where r.user_id = v_user and r.created_at > v_now - interval '1 hour') >= 5
    or (select count(*) from public.generation_reservations r
      where r.trip_id = target_trip_id and r.created_at > v_now - interval '10 minutes') >= 3 then
    raise exception 'Generation rate limit exceeded' using errcode = 'P0003';
  end if;
  insert into public.generation_reservations(trip_id, user_id, created_at)
    values (target_trip_id, v_user, v_now);
end;
$$;

-- Functions default to PUBLIC EXECUTE in PostgreSQL; explicitly close every entry point.
alter function public.create_trip_owner_membership() set search_path = '';
alter function public.set_updated_at() set search_path = '';
revoke all on function public.is_trip_member(uuid), public.can_manage_trip(uuid),
  public.ordinary_trim(text), public.is_validated_gemini_proposal(public.agent_proposals), public.can_read_gemini_day(uuid),
  public.create_trip_owner_membership(), public.set_updated_at(), public.bump_trip_revision(),
  public.bump_preference_revision(), public.validate_trip_proposal(public.trips, jsonb),
  public.save_trip_proposal(uuid, bigint, jsonb, text),
  public.decide_trip_proposal(uuid, uuid, text), public.reserve_generation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_trip_member(uuid), public.can_manage_trip(uuid),
  public.ordinary_trim(text), public.is_validated_gemini_proposal(public.agent_proposals), public.can_read_gemini_day(uuid),
  public.save_trip_proposal(uuid, bigint, jsonb, text),
  public.decide_trip_proposal(uuid, uuid, text), public.reserve_generation(uuid) to authenticated;

comment on table public.trip_preferences is
  'Confirmed ordinary group preferences only: interests, pace and budget sentiment. No sensitive individual profiles.';
comment on column public.agent_proposals.validation_result is
  'Server-produced SQL validation evidence; the payload is revalidated under the trip lock before activation.';
