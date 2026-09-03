-- Run only against a disposable Supabase project through:
-- npm exec --yes --package supabase@2.116.0 supabase -- db query --linked --file tests/database/live-rls.sql
-- Every fixture row is rolled back. No secrets or real user data belong here.

begin;

create function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception '%', message;
  end if;
end;
$$;

create function pg_temp.expect_denied(statement text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception 'Expected denied statement to fail: %', statement;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

create temp table live_ids (trip_id uuid not null);
grant select, insert on pg_temp.live_ids to authenticated;

insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'phase0-owner@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'phase0-planner@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'phase0-member@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'phase0-viewer@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'phase0-unrelated@example.test', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

with created as (
  insert into public.trips (name, owner_user_id, destination_name, start_date, end_date, budget_tier, pace, notes)
  values ('Phase 0 live RLS', auth.uid(), 'George Town', date '2026-10-01', date '2026-10-03', 'standard', 'balanced', 'rollback-only fixture')
  returning id
)
insert into live_ids (trip_id) select id from created;

-- Membership administration is deliberately server-only.  Fixtures are
-- therefore established by the privileged test connection before testing
-- ordinary authenticated roles.
reset role;
insert into public.trip_members (trip_id, user_id, display_name, role, consent_status)
select trip_id, '22222222-2222-2222-2222-222222222222', 'Planner', 'planner', 'granted' from live_ids;
insert into public.trip_members (trip_id, user_id, display_name, role, consent_status)
select trip_id, '33333333-3333-3333-3333-333333333333', 'Member', 'member', 'granted' from live_ids;
insert into public.trip_members (trip_id, user_id, display_name, role, consent_status)
select trip_id, '44444444-4444-4444-4444-444444444444', 'Viewer', 'viewer', 'granted' from live_ids;

select pg_temp.assert_true((select count(*) = 4 from public.trip_members where trip_id = (select trip_id from live_ids)), 'Owner membership setup failed.');

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
update public.trips set notes = 'Planner update verified' where id = (select trip_id from live_ids);
insert into public.trip_preferences (trip_id, kind, value, confirmed_by)
select ids.trip_id, 'interest', 'Food markets', member.id
from live_ids ids
join public.trip_members member on member.trip_id = ids.trip_id
where member.user_id = '22222222-2222-2222-2222-222222222222';
select pg_temp.assert_true((select notes = 'Planner update verified' from public.trips where id = (select trip_id from live_ids)), 'Planner update was denied.');
select pg_temp.assert_true((select count(*) = 1 from public.trip_preferences where trip_id = (select trip_id from live_ids)), 'Planner preference insert was denied.');

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select pg_temp.assert_true((select count(*) = 1 from public.trips where id = (select trip_id from live_ids)), 'Member could not read the trip.');
update public.trips set notes = 'member must not update' where id = (select trip_id from live_ids);
select pg_temp.assert_true((select notes = 'Planner update verified' from public.trips where id = (select trip_id from live_ids)), 'Member updated the trip.');
select pg_temp.expect_denied(format('insert into public.agent_proposals (trip_id, proposal_type, status, title, summary, payload) values (%L::uuid, %L, %L, %L, %L, %L::jsonb)', (select trip_id from live_ids), 'gemini_itinerary', 'pending', 'Denied direct write', 'Denied direct write', '{"summary":"Denied direct write","activities":[],"assumptions":[]}'));

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
select pg_temp.assert_true((select count(*) = 0 from public.trips where id = (select trip_id from live_ids)), 'Unrelated user could read the trip.');
update public.trips set notes = 'unrelated must not update' where id = (select trip_id from live_ids);
reset role;
select pg_temp.assert_true((select notes = 'Planner update verified' from public.trips where id = (select trip_id from live_ids)), 'Unrelated user updated the trip.');

rollback;
