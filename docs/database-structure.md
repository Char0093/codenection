# Database Structure Guardrails

## Purpose

This file defines the MVP Supabase/Postgres structure for the Travel Planner app. Implementation agents should treat this as the default schema contract unless the user explicitly changes product scope.

## Core Principles

- Every domain row belongs to a trip directly or through a trip-owned parent.
- `auth.users.id` is the source user identity.
- `trip_members.id` is the source traveler identity inside a trip.
- Sensitive profile data stays in `member_profiles`, protected by RLS.
- Telegram and provider integrations write structured event records; they do not own business state.
- Money is stored as integer minor units plus currency code.
- Timestamps are `timestamptz`.

## Enum Types

Recommended Postgres enums:

- `trip_role`: `owner`, `planner`, `member`, `viewer`
- `consent_status`: `pending`, `granted`, `revoked`
- `budget_tier`: `budget`, `standard`, `premium`, `luxury`
- `pace_level`: `relaxed`, `balanced`, `active`, `intense`
- `itinerary_item_type`: `activity`, `meal`, `transit`, `lodging`, `reservation`, `buffer`
- `itinerary_status`: `draft`, `generated`, `conflict`, `confirmed`
- `constraint_severity`: `preference`, `important`, `hard_blocker`
- `split_session_status`: `proposed`, `active`, `merging`, `completed`, `cancelled`
- `expense_split_method`: `equal`, `budget_tier`, `custom_weight`, `subgroup`
- `bot_event_status`: `pending_confirmation`, `confirmed`, `rejected`, `expired`, `failed`
- `provider_status`: `ok`, `degraded`, `mocked`, `failed`

## Tables

### `trips`

Trip-level setup and defaults.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `owner_user_id uuid not null references auth.users(id)`
- `name text not null`
- `destination_name text not null`
- `destination_place_id text null`
- `start_date date not null`
- `end_date date not null`
- `budget_tier budget_tier not null default 'standard'`
- `pace pace_level not null default 'balanced'`
- `base_currency char(3) not null default 'USD'`
- `basecamp_label text null`
- `basecamp_lat numeric(10,7) null`
- `basecamp_lng numeric(10,7) null`
- `notes text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `trip_members`

Membership, roles, consent, and display identity.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `user_id uuid null references auth.users(id)`
- `display_name text not null`
- `role trip_role not null default 'member'`
- `consent_status consent_status not null default 'pending'`
- `telegram_user_id text null`
- `home_currency char(3) not null default 'USD'`
- `joined_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:

- Unique `(trip_id, user_id)` where `user_id is not null`.
- Unique `(trip_id, telegram_user_id)` where `telegram_user_id is not null`.

### `member_profiles`

Sensitive traveler profile data.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_member_id uuid not null unique references trip_members(id) on delete cascade`
- `mobility_notes text null`
- `accessibility_requirements jsonb not null default '{}'`
- `chronic_health_notes text null`
- `sensory_sensitivities jsonb not null default '[]'`
- `severe_allergies jsonb not null default '[]'`
- `dietary_requirements jsonb not null default '[]'`
- `requires_halal boolean not null default false`
- `language_code text not null default 'en'`
- `budget_tier budget_tier null`
- `pace pace_level null`
- `emergency_contact jsonb null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Rules:

- Only use this data in planning when the linked `trip_members.consent_status = 'granted'`.
- Do not store inferred profile values unless confirmed.

### `destinations`

Candidate places, restaurants, and anchors used by planning and maps.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `provider text not null`
- `provider_place_id text null`
- `name text not null`
- `category text not null`
- `address text null`
- `lat numeric(10,7) null`
- `lng numeric(10,7) null`
- `opening_hours jsonb null`
- `price_tier int null`
- `accessibility_tags jsonb not null default '[]'`
- `dietary_tags jsonb not null default '[]'`
- `halal_status text null`
- `allergen_notes jsonb not null default '[]'`
- `weather_suitability jsonb not null default '{}'`
- `source_confidence numeric(4,3) null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `itinerary_days`

One row per trip date.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `day_date date not null`
- `status itinerary_status not null default 'draft'`
- `summary text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:

- Unique `(trip_id, day_date)`.

### `itinerary_items`

Activities, meals, transit, reservations, and buffers.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `itinerary_day_id uuid not null references itinerary_days(id) on delete cascade`
- `destination_id uuid null references destinations(id)`
- `type itinerary_item_type not null`
- `title text not null`
- `description text null`
- `start_time timestamptz null`
- `end_time timestamptz null`
- `estimated_cost_minor int null`
- `currency char(3) null`
- `intensity int null check (intensity between 1 and 5)`
- `travel_minutes_before int null`
- `is_fixed boolean not null default false`
- `hard_constraint_notes jsonb not null default '[]'`
- `score numeric(6,3) null`
- `explanations jsonb not null default '[]'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Rules:

- `is_fixed = true` items represent reservations, booked transport, or immovable commitments.

### `constraints`

Normalized constraints used by the planner.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `trip_member_id uuid null references trip_members(id) on delete cascade`
- `scope text not null`
- `key text not null`
- `value jsonb not null`
- `severity constraint_severity not null default 'preference'`
- `source text not null`
- `confirmed_at timestamptz null`
- `created_at timestamptz not null default now()`

Rules:

- Member-derived constraints require `trip_member_id`.
- Telegram-derived constraints require confirmation before `confirmed_at` is set.

### `subgroups`

Named traveler groups during split sessions.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `name text not null`
- `purpose text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `subgroup_members`

Join table between subgroups and trip members.

Required columns:

- `subgroup_id uuid not null references subgroups(id) on delete cascade`
- `trip_member_id uuid not null references trip_members(id) on delete cascade`
- `created_at timestamptz not null default now()`
- `primary key (subgroup_id, trip_member_id)`

### `split_sessions`

Split/merge execution state.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `status split_session_status not null default 'proposed'`
- `started_at timestamptz null`
- `merge_target_time timestamptz null`
- `rendezvous_label text null`
- `rendezvous_lat numeric(10,7) null`
- `rendezvous_lng numeric(10,7) null`
- `fallback_instructions text null`
- `asset_checklist jsonb not null default '[]'`
- `eta_snapshot jsonb not null default '{}'`
- `recommendation jsonb null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Rules:

- Activation requires confirmed subgroup membership and asset checks.

### `expenses`

Ledger expense header.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `paid_by_member_id uuid not null references trip_members(id)`
- `subgroup_id uuid null references subgroups(id)`
- `description text not null`
- `category text null`
- `amount_minor int not null check (amount_minor > 0)`
- `currency char(3) not null`
- `exchange_rate_to_base numeric(18,8) not null`
- `base_amount_minor int not null`
- `split_method expense_split_method not null`
- `receipt_path text null`
- `source text not null default 'web'`
- `confirmed_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Rules:

- Telegram-created expenses remain pending until `confirmed_at` is set.

### `expense_shares`

Per-member allocation for an expense.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `expense_id uuid not null references expenses(id) on delete cascade`
- `trip_member_id uuid not null references trip_members(id)`
- `share_minor int not null check (share_minor >= 0)`
- `weight numeric(12,4) null`
- `created_at timestamptz not null default now()`

Constraints:

- Unique `(expense_id, trip_member_id)`.

### `settlements`

Computed peer-to-peer settlement instructions.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `from_member_id uuid not null references trip_members(id)`
- `to_member_id uuid not null references trip_members(id)`
- `amount_minor int not null check (amount_minor > 0)`
- `currency char(3) not null`
- `status text not null default 'suggested'`
- `computed_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`

Rules:

- Settlement rows are derived data and may be regenerated.

### `bot_events`

Telegram command, intent, and confirmation records.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid null references trips(id) on delete cascade`
- `telegram_chat_id text not null`
- `telegram_user_id text null`
- `event_type text not null`
- `status bot_event_status not null default 'pending_confirmation'`
- `payload jsonb not null default '{}'`
- `raw_message_excerpt text null`
- `expires_at timestamptz null`
- `confirmed_by_member_id uuid null references trip_members(id)`
- `confirmed_at timestamptz null`
- `created_at timestamptz not null default now()`

Rules:

- `raw_message_excerpt` must be short and temporary.
- Confirmed actions should mutate domain tables in a transaction with the bot event status update.

### `provider_events`

Observability for live and mock provider calls.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid null references trips(id) on delete cascade`
- `provider_name text not null`
- `provider_kind text not null`
- `status provider_status not null`
- `request_fingerprint text null`
- `response_summary jsonb not null default '{}'`
- `error_message text null`
- `freshness_at timestamptz null`
- `created_at timestamptz not null default now()`

## Recommended Indexes

- `trip_members(trip_id)`
- `trip_members(user_id)`
- `member_profiles(trip_member_id)`
- `destinations(trip_id, category)`
- `itinerary_days(trip_id, day_date)`
- `itinerary_items(itinerary_day_id, start_time)`
- `constraints(trip_id, severity)`
- `constraints(trip_member_id)`
- `subgroups(trip_id)`
- `split_sessions(trip_id, status)`
- `expenses(trip_id, created_at)`
- `expense_shares(expense_id)`
- `settlements(trip_id, computed_at)`
- `bot_events(trip_id, status)`
- `bot_events(telegram_chat_id, created_at)`
- `provider_events(trip_id, provider_kind, created_at)`
- `agent_jobs(trip_id, status, created_at)`
- `agent_proposals(trip_id, status, created_at)`
- `agent_eval_runs(eval_name, agent_name, created_at)`

## RLS Policy Model

Enable RLS on all application tables.

Baseline access rules:

- A user can read a trip if they are linked to a `trip_members` row for that trip.
- A user can update trip setup only if their `trip_members.role` is `owner` or `planner`.
- A user can read member display data for members in their trips.
- A user can read sensitive `member_profiles` only for trips they belong to.
- A user can update only their own linked `member_profiles` row unless they are the trip owner handling deletion/export.
- Expense and itinerary writes require `owner` or `planner`, except members may create their own pending expenses.
- Bot/provider service-role writes happen only from trusted server code, never browser clients.

## Migration Order

1. Enable extensions and enums.
2. Create `trips`.
3. Create `trip_members`.
4. Create `member_profiles`.
5. Create `destinations`.
6. Create `itinerary_days` and `itinerary_items`.
7. Create `constraints`.
8. Create `subgroups`, `subgroup_members`, and `split_sessions`.
9. Create `expenses`, `expense_shares`, and `settlements`.
10. Create `bot_events` and `provider_events`.
11. Create agentic support tables from `docs/agentic-architecture.md` if the agentic layer is in scope.
12. Add indexes.
13. Enable RLS and policies.
14. Add update timestamp triggers.

## Out of Scope for MVP Schema

- Payment account tables.
- Native booking records with payment guarantees.
- Insurance or medical record tables.
- Continuous GPS trace storage.
- Long-term raw chat transcript storage.
- Multi-tenant organization billing.
