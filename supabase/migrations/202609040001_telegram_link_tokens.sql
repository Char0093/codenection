create table public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_member_id uuid not null references public.trip_members(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  telegram_user_id text,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);
create index telegram_link_tokens_trip_idx on public.telegram_link_tokens(trip_id, created_at desc);
create index telegram_link_tokens_member_idx on public.telegram_link_tokens(trip_member_id, created_at desc);
alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_link_tokens from public, anon, authenticated, service_role;

create function public.create_telegram_link_token(
  target_trip_id uuid, target_member_id uuid, token_hash text, expires_at timestamptz
) returns public.telegram_link_tokens language plpgsql security definer set search_path = '' as $$
declare
  v_token public.telegram_link_tokens;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.can_manage_trip(target_trip_id) then
    raise exception 'Owner or planner required' using errcode = '42501';
  end if;
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;
  if expires_at is null or expires_at <= clock_timestamp()
    or expires_at > clock_timestamp() + interval '7 days' then
    raise exception 'Invalid token expiry' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.trip_members tm where tm.id = target_member_id and tm.trip_id = target_trip_id
  ) then
    raise exception 'Trip member not found' using errcode = 'P0002';
  end if;
  insert into public.telegram_link_tokens(trip_id, trip_member_id, token_hash, created_by, expires_at)
  values (target_trip_id, target_member_id, create_telegram_link_token.token_hash, auth.uid(), expires_at)
  returning * into v_token;
  return v_token;
end;
$$;

create function public.redeem_telegram_link_token(
  token_hash text, telegram_user_id text, telegram_display_name text
) returns table(trip_id uuid, member_id uuid, role public.trip_role, display_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_token public.telegram_link_tokens;
  v_member public.trip_members;
begin
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$'
    or telegram_user_id is null or telegram_user_id !~ '^[1-9][0-9]{0,19}$'
    or telegram_display_name is null or char_length(public.ordinary_trim(telegram_display_name)) not between 1 and 120 then
    raise exception 'Invalid Telegram link input' using errcode = '22023';
  end if;
  select * into v_token from public.telegram_link_tokens t
    where t.token_hash = redeem_telegram_link_token.token_hash for update;
  if not found or v_token.redeemed_at is not null or v_token.expires_at <= clock_timestamp() then
    raise exception 'Telegram link token not found' using errcode = 'P0002';
  end if;
  select * into v_member from public.trip_members tm where tm.id = v_token.trip_member_id for update;
  if not found or v_member.trip_id <> v_token.trip_id then
    raise exception 'Trip member not found' using errcode = 'P0002';
  end if;
  update public.trip_members tm set telegram_user_id = redeem_telegram_link_token.telegram_user_id,
    display_name = public.ordinary_trim(redeem_telegram_link_token.telegram_display_name)
    where tm.id = v_member.id returning * into v_member;
  update public.telegram_link_tokens t set redeemed_at = clock_timestamp(),
    telegram_user_id = redeem_telegram_link_token.telegram_user_id
    where t.id = v_token.id;
  return query select v_member.trip_id, v_member.id, v_member.role, v_member.display_name;
end;
$$;

revoke all on function public.create_telegram_link_token(uuid, uuid, text, timestamptz),
  public.redeem_telegram_link_token(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_telegram_link_token(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.redeem_telegram_link_token(text, text, text) to anon;

comment on table public.telegram_link_tokens is
  'Hashed, expiring, single-use Telegram account link tokens. Raw tokens are never stored.';
