# Travel Planner MVP Implementation Plan

## Summary
Build a Next.js + Supabase MVP for a group trip-planning command center. The MVP will support trip creation, member profiles, constraint-aware itinerary generation, map-based planning, Telegram-assisted confirmations, split/merge coordination, and shared expense settlement.

Use hybrid integrations: real maps, weather, currency conversion, and Telegram bot flows where practical; mock booking, live availability, and complex transit disruption feeds behind provider adapters so they can be replaced later.

## Key Changes
- Create a Next.js app with Supabase Auth, Postgres, Storage, and Realtime.
- Core product surfaces:
  - Trip dashboard with destination, dates, budget tier, pace, group members, and itinerary status.
  - Member profile forms for mobility, health, sensory, allergy, dietary, language, and budget constraints.
  - Itinerary builder showing days, activities, meals, travel time, intensity, cost, opening hours, and accessibility/dietary fit.
  - Map view for activity locations, rendezvous points, subgroup routes, and fallback anchors.
  - Shared ledger for expenses, subgroup attribution, currency conversion, balances, and minimal-transfer settlement.
  - Telegram bot commands for preference capture, expense logging, split/merge confirmation, and itinerary alerts.

## Implementation Details
- Data model:
  - `trips`, `trip_members`, `member_profiles`, `destinations`, `itinerary_days`, `itinerary_items`, `constraints`, `subgroups`, `split_sessions`, `expenses`, `expense_shares`, `settlements`, `bot_events`, and `provider_events`.
  - Store sensitive health/diet/accessibility data with row-level security and explicit trip-member access rules.
  - Keep raw Telegram messages short-lived; persist only confirmed extracted preferences and audit events.
- Planning engine:
  - Implement a deterministic scoring pipeline for activities and restaurants using budget, pace, travel time, opening hours, accessibility, allergies, halal suitability, weather suitability, and member constraints.
  - Produce explanations for recommendations, such as “low walking distance,” “halal verified,” or “indoors due to rain.”
  - Include hard constraints for severe allergies, immovable reservations, transport departures, and member accessibility blockers.
- Telegram bot:
  - Support `/start`, `/trip`, `/expense`, `/split`, `/merge`, `/status`, and confirmation callbacks.
  - All inferred preferences or schedule-changing actions require inline confirmation before persistence.
  - For MVP, parse chat intent with simple classification plus rule-based extraction; avoid automatic execution from ambiguous messages.
- Split/merge flow:
  - `/split` creates subgroup itineraries, checks shared assets, and assigns subgroup-specific route guidance.
  - `/merge` compares ETA deltas and recommends one of three behaviors:
    - Under 20 minutes: wait at nearby anchor point.
    - 20 to 60 minutes: suggest nearby low-commitment activities.
    - Over 60 minutes: suggest productive delegation or direct routing to next fixed commitment.
  - Add fallback rendezvous instructions for signal loss.
- External providers:
  - Real adapters: map/geocoding, weather, exchange rates, Telegram.
  - Mock adapters: flights, hotels, live activities, transit disruption, price-drop alerts.
  - Expose each provider through a typed service interface so mocked providers can be swapped without changing product code.
- Privacy and safety:
  - Add consent state per trip member before Telegram parsing or profile sharing.
  - Add trip deletion/export flows for user data.
  - Add safety disclaimers and emergency-contact fields, but do not implement automated emergency dispatch in MVP.

## Test Plan
- Unit tests:
  - Constraint scoring.
  - Allergy/dietary hard-block behavior.
  - Ledger split rules.
  - Multi-currency conversion normalization.
  - Minimal-transfer settlement.
  - Split/merge ETA bucket selection.
- Integration tests:
  - Trip creation through itinerary generation.
  - Telegram command to pending confirmation to persisted action.
  - Expense creation and settlement recalculation.
  - Provider fallback from mocked/live adapters.
- E2E tests:
  - Create trip, add members, generate itinerary, inspect map.
  - Log subgroup expense through Telegram flow.
  - Start split session, merge delayed subgroup, receive fallback recommendation.
- Acceptance criteria:
  - A group can create a trip, add constraints, generate a viable itinerary, view it on a map, log shared expenses, settle balances, and coordinate one split/merge flow.
  - No inferred Telegram action changes itinerary, expenses, or subgroup state without confirmation.
  - Severe allergy and accessibility blockers prevent unsafe recommendations.

## Assumptions
- MVP targets a responsive web app plus Telegram bot, not native mobile apps.
- Stack is Next.js + Supabase.
- Maps, weather, exchange rates, and Telegram are live integrations.
- Flights, hotels, activities, transit disruption, and price-drop monitoring use mock providers in v1.
- The first release prioritizes one active trip per group and practical planning reliability over full autonomous optimization.
