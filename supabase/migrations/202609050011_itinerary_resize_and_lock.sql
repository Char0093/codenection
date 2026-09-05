-- Implementation_Plan.md Task 3.4 (Calendar timeline editing): extends the move-only
-- reorder_itinerary_item into a move+resize RPC (an optional new_duration_minutes, honoring the
-- existing 15-480 minute domain contract Gemini's own activities are validated against), and adds
-- real fixed_commitment enforcement -- the original function never checked it, so a "locked"
-- reservation could silently be dragged despite the plan's own Hard Constraints table naming
-- "Immovable reservations or booked transport." unlock_itinerary_item is the only way to make a
-- fixed_commitment item editable again, matching "changing one requires an explicit unlock" --
-- unlocking IS that explicit confirmation step, a real persisted action, not a client-only fiction.

drop function if exists public.reorder_itinerary_item(uuid, uuid, bigint, date, time without time zone);

create function public.reorder_itinerary_item(
  target_trip_id uuid, target_item_id uuid, expected_revision bigint,
  new_local_date date, new_local_start_time time without time zone,
  new_duration_minutes int default null
) returns public.itinerary_items language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_item public.itinerary_items;
  v_day public.itinerary_days;
  v_duration interval;
  v_new_end_ts timestamp;
  v_new_end time without time zone;
  v_conflict boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if new_duration_minutes is not null and new_duration_minutes not between 15 and 480 then
    raise exception 'Duration must be between 15 and 480 minutes' using errcode = '22023';
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

  select i.* into v_item from public.itinerary_items i
    join public.itinerary_days d on d.id = i.itinerary_day_id
    where i.id = target_item_id and d.trip_id = target_trip_id for update;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  if v_item.local_start_time is null or v_item.local_end_time is null then
    raise exception 'This activity predates local-time tracking and cannot be dragged' using errcode = '22023';
  end if;
  if v_item.fixed_commitment then
    raise exception 'Fixed reservations must be unlocked before they can be moved or resized' using errcode = '23514';
  end if;

  select d.* into v_day from public.itinerary_days d where d.trip_id = target_trip_id and d.day_date = new_local_date;
  if not found then raise exception 'Target day not found' using errcode = 'P0002'; end if;

  if new_duration_minutes is null then
    v_duration := v_item.local_end_time - v_item.local_start_time;
  else
    v_duration := make_interval(mins => new_duration_minutes);
  end if;
  if v_duration <= interval '0' then
    raise exception 'Activity has no positive duration to preserve' using errcode = '22023';
  end if;
  v_new_end_ts := (new_local_date::timestamp + new_local_start_time) + v_duration;
  if v_new_end_ts::date > new_local_date then
    raise exception 'Activity would cross midnight' using errcode = '22023';
  end if;
  v_new_end := v_new_end_ts::time;

  select exists (
    select 1 from public.itinerary_items other
    where other.itinerary_day_id = v_day.id and other.id <> v_item.id
      and other.local_start_time is not null and other.local_end_time is not null
      and new_local_start_time < other.local_end_time and v_new_end > other.local_start_time
  ) into v_conflict;
  if v_conflict then raise exception 'Overlaps another activity that day' using errcode = '23514'; end if;

  update public.itinerary_items set
    itinerary_day_id = v_day.id,
    local_date = new_local_date,
    local_start_time = new_local_start_time,
    local_end_time = v_new_end,
    starts_at = (new_local_date::timestamp + new_local_start_time) at time zone 'UTC',
    ends_at = v_new_end_ts at time zone 'UTC',
    updated_at = clock_timestamp()
  where id = v_item.id
  returning * into v_item;

  update public.trips set revision = revision + 1 where id = target_trip_id;
  return v_item;
end;
$$;

revoke all on function public.reorder_itinerary_item(uuid, uuid, bigint, date, time without time zone, int) from public, anon, service_role;
grant execute on function public.reorder_itinerary_item(uuid, uuid, bigint, date, time without time zone, int) to authenticated;

create function public.unlock_itinerary_item(target_trip_id uuid, target_item_id uuid, expected_revision bigint)
returns public.itinerary_items language plpgsql security definer set search_path = '' as $$
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

  update public.itinerary_items set fixed_commitment = false, updated_at = clock_timestamp()
  where id = v_item.id
  returning * into v_item;

  update public.trips set revision = revision + 1 where id = target_trip_id;
  return v_item;
end;
$$;

revoke all on function public.unlock_itinerary_item(uuid, uuid, bigint) from public, anon, service_role;
grant execute on function public.unlock_itinerary_item(uuid, uuid, bigint) to authenticated;
