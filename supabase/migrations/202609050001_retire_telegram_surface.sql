-- Forward-only retirement of the Telegram integration surface.
--
-- The Telegram bot and Mini App are replaced by the native in-app collaborative workspace
-- (see docs/features/collaborative-workspace.md). No application code on main reads these
-- columns; earlier migrations are left untouched, as required by the forward-only rule.

-- Dropping the column also drops the dependent unique (trip_id, telegram_user_id) constraint.
alter table public.trip_members drop column if exists telegram_user_id;

-- public.constraints is a retired, access-revoked table (202609030004). Narrow its source
-- domain so no Telegram-era value remains reachable if the table is ever revived.
update public.constraints set source = 'chat_confirmed' where source = 'telegram_confirmed';
alter table public.constraints drop constraint if exists constraints_source_check;
alter table public.constraints add constraint constraints_source_check
  check (source in ('profile', 'web', 'chat_confirmed'));
