# Framework and Architecture Guardrails

## Stack

- Use Next.js with the App Router, TypeScript, React Server Components where appropriate, and server actions or route handlers for server-side mutations.
- Use Supabase for Auth, Postgres, Storage, and Realtime.
- Use Postgres row-level security for trip-member access control.
- Use a typed service layer between UI/routes and domain logic.
- Use provider adapters for all external APIs.

## Project Shape

Recommended structure:

- `app/`: routes, pages, layouts, route handlers.
- `components/`: reusable UI components.
- `features/`: feature-specific UI, actions, queries, and schemas.
- `lib/domain/`: pure business logic such as scoring, settlements, split/merge decisions.
- `lib/providers/`: external provider interfaces and implementations.
- `lib/supabase/`: Supabase clients, generated types, auth helpers.
- `supabase/migrations/`: schema, RLS policies, indexes, seed data.
- `tests/`: unit, integration, and E2E tests.

Do not put business rules directly inside React components.

## Data Boundaries

- Treat Supabase as the system of record.
- All tables must include `created_at`; mutable domain tables should include `updated_at`.
- Sensitive profile fields must only be readable by authorized trip members.
- Use explicit trip membership checks in RLS policies.
- Store pending Telegram confirmations as structured events, not as raw indefinite chat transcripts.

## Domain Rules

- Deterministic logic belongs in pure functions with unit tests.
- Recommendation explanations must be generated from actual scoring or constraint decisions.
- Provider failures must degrade gracefully with cached, mock, or user-visible fallback state.
- Schedule-changing, expense-changing, or subgroup-changing actions from Telegram require confirmation.

## UI Rules

- Build the usable app first, not a marketing landing page.
- Keep the interface dense, operational, and scan-friendly.
- Use clear forms, tables, maps, tabs, filters, status badges, and confirmation dialogs.
- Accessibility and dietary safety should appear as decision signals, not hidden metadata.

## Testing Expectations

- Unit test all pure domain modules.
- Integration test route handlers/server actions that write trip, expense, Telegram, or provider state.
- E2E test the primary user path: create trip, add members, generate itinerary, view map, log expense, settle, split, merge.
- Do not mark a feature complete without tests for its critical failure modes.
