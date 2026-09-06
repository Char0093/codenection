# Travel Planner MVP Development Guardrails

These documents are the implementation guardrails for the Travel Planner MVP. They convert the product concept and implementation plan into stable engineering boundaries so development agents do not drift into unrelated architecture, features, or provider choices.

## Source Priority

When instructions conflict, use this order:

1. Direct user request for the current task.
2. `Implementation_Plan.md`.
3. Files in this `docs/` directory.

## MVP Scope

The MVP must deliver:

- First-login Travel DNA onboarding that stores a reusable, self-only preference baseline and then
  redirects to the chat-group home.
- Responsive web app with a `/chats` home for the user's trip groups; one chat group is exactly one
  trip, and selecting it scopes chat history and planning to that trip.
- Supabase-backed trip, member, itinerary, split/merge, chat, provider, and ledger data.
- Constraint-aware itinerary generation with deterministic scoring.
- Map, weather, and currency integration adapters.
- Mock adapters for booking, availability, price drops, flight status, and transit disruption.
- Explicit user confirmation before chat-derived or AI-proposed changes mutate trip state.
- Privacy controls for consent, sensitive profile data, trip export, and trip deletion.

## Required Docs

- `implementation-status.md`: point-in-time delivery status, remaining acceptance work, and the recommended next execution order for development agents.
- `superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md`: current product and data-ownership decision for first-login onboarding and trip chat groups.
- `superpowers/plans/2026-09-06-first-login-travel-dna-chat-groups.md`: ordered implementation plan for that migration.
- `framework.md`: stack, architecture, coding boundaries, Supabase usage, testing expectations.
- `database-structure.md`: Supabase/Postgres schema, table boundaries, indexes, and RLS model.
- `agentic-architecture.md`: bounded agent roles, proposal workflow, human confirmation rules, and eval requirements.
- `features/trip-dashboard.md`: selected-trip setup and overview behavior.
- `features/member-profiles.md`: global Travel DNA, member consent, accessibility, dietary, health, and trip overrides.
- `features/itinerary-planning.md`: scoring, hard constraints, explanations, and itinerary generation.
- `features/map-coordination.md`: map display, rendezvous anchors, and split/merge coordination.
- `features/shared-ledger.md`: expenses, subgroup attribution, currency conversion, and settlement.
- `features/collaborative-workspace.md`: chat-group home, trip-scoped realtime chat, embedded AI assistant, draggable timeline, and confirmation boundaries.
- `features/provider-adapters.md`: real and mock provider contracts.
- `features/privacy-safety.md`: consent, retention, RLS, export/delete, and safety boundaries.

## Drift Rules

- Do not add native mobile apps during web Phases 0–9. The conditional post-web Android companion
  is specified in `Implementation_Plan.md` Phase 10 and has explicit start gates.
- Do not implement autonomous emergency dispatch.
- Do not implement full booking/rebooking automation in the MVP.
- Trip chat is persisted under RLS and deleted with the trip. Send the assistant only the current trip's context and a bounded recent-message window.
- Do not let AI/NLP inferred actions directly mutate itinerary, expense, subgroup, or profile state.
- Do not bypass hard safety constraints for severe allergies or accessibility blockers.
- Do not couple UI code directly to third-party APIs; use provider adapters.
- Do not introduce a second database, auth provider, or backend framework without explicit approval.
