# Feature: Trip Dashboard

## Purpose

The trip dashboard is the setup and overview surface for the currently selected chat group/trip.
The cross-trip entry point is `/chats`, not this dashboard.

## MVP Behavior

- Create the group from `/chats` with a name only, then complete destination, start date, end date,
  budget tier, pace, home currency, and notes here.
- Treat an incomplete group as a draft: chat remains usable, while itinerary generation clearly
  identifies and blocks on missing required setup.
- Show members, consent state, profile completion, and outstanding confirmations.
- Show itinerary generation status and top conflicts.
- Show current split/merge state if the group is branched.
- Show ledger summary with per-person balances and unsettled expenses.
- Show provider health for maps, weather, exchange rates, realtime, and mock booking feeds.

## Data

Use these tables:

- `trips`
- `trip_members`
- `member_profiles`
- `itinerary_days`
- `itinerary_items`
- `split_sessions`
- `expenses`
- `settlements`
- `provider_events`
- `bot_events`

## Required States

- Empty trip with setup prompts.
- Trip with missing member consent.
- Trip ready for itinerary generation.
- Generated itinerary with conflicts.
- Active split session.
- Provider degraded or mocked state.
- Name-only draft with chat enabled and planning disabled.

## Non-Goals

- Cross-trip analytics or portfolio management beyond the membership list on `/chats`.
- Public itinerary sharing.
- Native mobile dashboard.
- Full booking management.
