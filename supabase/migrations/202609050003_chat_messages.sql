-- Implementation_Plan.md Task 3.1: append-only trip chat. Visibility is enforced by RLS on this
-- table, never by the Realtime channel name -- a client subscribed to another trip's channel
-- receives nothing it is not already authorized to read (Supabase's postgres_changes replication
-- re-checks SELECT RLS per subscriber, per row).

create type public.chat_author_kind as enum ('member', 'assistant', 'system');

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_member_id uuid references public.trip_members(id) on delete set null,
  author_kind public.chat_author_kind not null default 'member',
  body text not null check (char_length(public.ordinary_trim(body)) between 1 and 4000),
  proposal_id uuid references public.agent_proposals(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A member-authored row must actually be authored by a trip member; assistant/system rows
  -- (posted through a security-definer function, not this constraint's concern) carry no member.
  check (author_kind = 'member' or author_member_id is null)
);

create index chat_messages_trip_id_created_at_idx on public.chat_messages(trip_id, created_at, id);

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from public, anon, authenticated, service_role;
grant select on public.chat_messages to authenticated;
grant insert (trip_id, author_member_id, author_kind, body) on public.chat_messages to authenticated;

create policy "trip members can read chat" on public.chat_messages
for select to authenticated using (public.is_trip_member(trip_id));

-- Only ever a member speaking as themselves. Assistant and system rows are never inserted
-- through this policy -- they go through a security-definer function added when Task 3.3 needs
-- one, so a member can never forge an assistant or system message.
create policy "members post their own chat messages" on public.chat_messages
for insert to authenticated with check (
  author_kind = 'member'
  and exists (
    select 1 from public.trip_members tm
    where tm.id = author_member_id and tm.trip_id = chat_messages.trip_id and tm.user_id = auth.uid()
  )
);

-- No update or delete grant: the table is append-only by construction, not just convention.

-- Guarded: Supabase projects pre-create this publication; local PGlite test runs do not, and
-- must not fail the migration over a platform-managed object that plain Postgres has no concept of.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $$;

comment on table public.chat_messages is
  'Append-only trip chat per Implementation_Plan.md Section VI. Never updated or deleted; RLS scopes every read and write to trip membership.';
