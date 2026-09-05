-- Dev-only convenience, same spirit as components/login-form.tsx's dev password sign-in: exempt
-- the seeded dev_test@gmail.com account from reserve_generation's anti-abuse rate limit so manual
-- testing isn't throttled by the same 3-per-10-minutes / 5-per-hour caps real users face. Every
-- other account is completely unaffected. This is a literal-email carve-out in a security-definer
-- function -- acceptable only because this project has no real users yet; remove before any
-- production launch rather than letting it become a permanent backdoor.
create or replace function public.reserve_generation(target_trip_id uuid)
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
  if coalesce(auth.jwt() ->> 'email', '') <> 'dev_test@gmail.com' then
    if (select count(*) from public.generation_reservations r
        where r.user_id = v_user and r.created_at > v_now - interval '1 hour') >= 5
      or (select count(*) from public.generation_reservations r
        where r.trip_id = target_trip_id and r.created_at > v_now - interval '10 minutes') >= 3 then
      raise exception 'Generation rate limit exceeded' using errcode = 'P0003';
    end if;
  end if;
  insert into public.generation_reservations(trip_id, user_id, created_at)
    values (target_trip_id, v_user, v_now);
end;
$$;
