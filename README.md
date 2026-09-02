# Adaptive Group Travel Planner

Consent-first group travel planning for a hackathon MVP. The web dashboard establishes the trip, members, budget, pace, and optional accessibility/dietary requirements. Later phases add itinerary intelligence, live Telegram coordination, split/merge workflows, and contingency suggestions.

## Phase 0 status

- Next.js application scaffold and responsive trip setup dashboard
- Supabase environment contract and foundational migration
- Trip, member, profile-consent, and provider-observability schema
- Row-level security baseline for trip membership and consented profiles
- Typed domain and provider-adapter boundaries

## Run locally

```bash
npm install
copy .env.example .env.local
npm run dev
```

Run the migration from `supabase/migrations/` against the linked Supabase project before connecting the dashboard to persistence.

## Safety boundary

Accessibility, health, allergy, dietary, and halal data is optional and must only influence planning after a member grants explicit consent. Telegram-derived changes will require confirmation in the bot phase.
