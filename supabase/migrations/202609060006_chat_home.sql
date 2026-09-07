-- Chat-group home (spec §2.3 / §5, revised 2026-09-07). One row per trip the caller is a
-- member of, ordered by recent chat activity, with a BOUNDED latest message (lateral limit
-- 1), a member count, and at most 8 avatars. security invoker -> the caller's RLS scopes
-- `trips` to their own memberships (`owner_user_id = auth.uid() or is_trip_member(id)`) and
-- `chat_messages` per row; nothing here reads another user's data.

create function public.chat_home()
returns table (
  id uuid,
  name text,
  status public.trip_status,
  destination_name text,
  start_date date,
  end_date date,
  trip_mode public.trip_mode,
  planned_duration_days int,
  proposed_budget_tier public.budget_tier,
  member_count int,
  member_avatars jsonb,
  latest_message_body text,
  latest_message_at timestamptz,
  activity_at timestamptz
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    t.id, t.name, t.status, t.destination_name, t.start_date, t.end_date,
    t.trip_mode, t.planned_duration_days, t.proposed_budget_tier,
    (select count(*)::int from public.trip_members m where m.trip_id = t.id) as member_count,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'displayName', a.display_name) order by a.joined_at)
      from (
        select m.id, m.display_name, m.joined_at
        from public.trip_members m
        where m.trip_id = t.id
        order by m.joined_at
        limit 8
      ) a
    ), '[]'::jsonb) as member_avatars,
    lm.body as latest_message_body,
    lm.created_at as latest_message_at,
    coalesce(lm.created_at, t.updated_at) as activity_at
  from public.trips t
  left join lateral (
    select cm.body, cm.created_at
    from public.chat_messages cm
    where cm.trip_id = t.id
    order by cm.created_at desc, cm.id desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, t.updated_at) desc, t.id desc;
$$;
revoke all on function public.chat_home() from public, anon;
grant execute on function public.chat_home() to authenticated;

comment on function public.chat_home() is
  'Chat-group home listing (spec §2.3). Bounded reads: one lateral latest message + 8-avatar cap per trip. Self-scoped by the caller''s trips RLS.';
