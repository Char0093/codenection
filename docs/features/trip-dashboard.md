# Feature: Trip Dashboard

## Purpose

The trip dashboard is the command center for one active group trip. It shows setup progress, trip constraints, group readiness, itinerary status, expense status, and coordination alerts.

## MVP Behavior

- Create and edit one trip with destination, start date, end date, budget tier, pace, home currency, and notes.
- Show members, consent state, profile completion, and outstanding confirmations.
- Show itinerary generation status and top conflicts.
- Show current split/merge state if the group is branched.
- Show ledger summary with per-person balances and unsettled expenses.
- Show provider health for maps, weather, exchange rates, Telegram, and mock booking feeds.

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

## Non-Goals

- Multi-trip portfolio management.
- Public itinerary sharing.
- Native mobile dashboard.
- Full booking management.
