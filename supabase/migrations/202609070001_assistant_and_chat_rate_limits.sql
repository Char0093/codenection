-- Program audit fix (2026-09-07): two independent gaps between the app's contract and the
-- database's actual enforcement.
--
-- P1 -- app/actions/assistant.ts lets any trip member ask the assistant, then calls
-- reserve_generation, whose gate requires public.can_manage_trip (owner/planner only,
-- correctly and deliberately -- see the "rejects unauthorized users" test in
-- tests/database/migrations.test.ts, which must keep failing for an ordinary member calling
-- reserve_generation for a full itinerary generation). Reusing that RPC for the assistant
-- silently breaks the assistant for every ordinary member instead. This adds a SEPARATE,
-- appropriately-scoped reservation RPC for assistant prompts -- membership only, no
-- `status = 'ready'` gate (chat/assistant is usable on a draft trip; only Plan/Timeline need
-- a ready trip) -- backed by its own reservation table so a chatty member's assistant usage
-- never eats into (or is throttled by) the owner/planner-only generation quota, and vice
-- versa.
--
-- P2 -- chat_messages accepts a direct `insert` grant for `authenticated` (app/lib/chat/
-- repository.ts's sendMessage calls PostgREST directly from the browser -- there is no server
-- action in that path to rate-limit in application code). Nothing capped how often one member
-- could insert, so a member could script repeated direct PostgREST inserts to spam a trip and
-- crowd out the bounded 20-message window the assistant reads as context. A BEFORE INSERT
-- trigger enforces the limit at the table itself, so it applies regardless of insert path.

-- ===========================================================================================
-- 1. Assistant prompt reservation -- membership-gated, no ready-status requirement, own quota.
-- ===========================================================================================
create table public.assistant_reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index assistant_reservations_user_time_idx on public.assistant_reservations(user_id, created_at);
create index assistant_reservations_trip_time_idx on public.assistant_reservations(trip_id, created_at);
alter table public.assistant_reservations enable row level security;
revoke all on public.assistant_reservations from public, anon, authenticated, service_role;

-- Mirrors reserve_generation's shape (auth check, membership check, dual-window rate limit,
-- dev_test@gmail.com exemption) with the two deliberate differences noted above.
create function public.reserve_assistant_prompt(target_trip_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.trips t where t.id = target_trip_id) then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  if not public.is_trip_member(target_trip_id) then
    raise exception 'You are not a member of this trip' using errcode = '42501';
  end if;
  -- Fixed user-then-trip order, matching reserve_generation, so the two RPCs never deadlock
  -- against each other when called concurrently for the same user/trip.
  perform pg_advisory_xact_lock(hashtextextended('assistant:user:' || v_user::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('assistant:trip:' || target_trip_id::text, 0));
  v_now := clock_timestamp();
  if coalesce(auth.jwt() ->> 'email', '') <> 'dev_test@gmail.com' then
    if (select count(*) from public.assistant_reservations r
        where r.user_id = v_user and r.created_at > v_now - interval '1 hour') >= 15
      or (select count(*) from public.assistant_reservations r
        where r.trip_id = target_trip_id and r.created_at > v_now - interval '10 minutes') >= 5 then
      raise exception 'Assistant rate limit exceeded' using errcode = 'P0003';
    end if;
  end if;
  insert into public.assistant_reservations(trip_id, user_id, created_at)
    values (target_trip_id, v_user, v_now);
end;
$$;
revoke all on function public.reserve_assistant_prompt(uuid) from public, anon;
grant execute on function public.reserve_assistant_prompt(uuid) to authenticated;

comment on function public.reserve_assistant_prompt(uuid) is
  'Assistant-prompt rate limit (program audit, 2026-09-07). Membership-gated (not can_manage_trip), no ready-status requirement -- deliberately distinct from reserve_generation, which stays owner/planner-only for full itinerary generation.';

-- ===========================================================================================
-- 2. Chat message rate limit -- enforced at the table so a direct PostgREST insert cannot
--    bypass it. Scoped by author_member_id, which already uniquely identifies one (trip,
--    user) membership, so this is inherently per-member-per-trip.
-- ===========================================================================================
create function public._chat_messages_rate_limit()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_recent int;
begin
  if new.author_kind = 'member' then
    -- Re-audit fix: a plain count-then-compare here let concurrent inserts for the same
    -- member all read the same pre-insert count under READ COMMITTED and all pass the >= 15
    -- check together, since none of them see each other's still-uncommitted rows. Serialize
    -- per author_member_id with a transaction-scoped advisory lock before counting, the same
    -- pattern reserve_generation/reserve_assistant_prompt already use for their own quotas --
    -- the second-and-later concurrent inserts for one member now queue behind the first and
    -- each count reflects every prior insert that already committed, not just what happened
    -- to be visible when its own snapshot was taken.
    perform pg_advisory_xact_lock(hashtextextended('chat_messages:member:' || new.author_member_id::text, 0));
    select count(*) into v_recent
    from public.chat_messages
    where author_member_id = new.author_member_id
      and created_at > clock_timestamp() - interval '30 seconds';
    if v_recent >= 15 then
      raise exception 'Too many messages. Please slow down.' using errcode = 'P0004';
    end if;
  end if;
  return new;
end;
$$;

create trigger chat_messages_rate_limit before insert on public.chat_messages
  for each row execute function public._chat_messages_rate_limit();

comment on function public._chat_messages_rate_limit() is
  'Program audit fix (2026-09-07): caps a member to 15 chat_messages inserts per 30 seconds, enforced at the table so a direct PostgREST insert cannot bypass it (sendMessage in lib/chat/repository.ts has no server-side hop to rate-limit in application code).';
