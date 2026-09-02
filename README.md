# codenection
# Adaptive Group Travel Planner — Hackathon Implementation Plan

## Summary

Build a greenfield, full-stack MVP using **Next.js + Tailwind** for pre-trip planning and **FastAPI + aiogram** for a live Telegram group coordinator. The end-to-end demo flow is: configure a trip on the web → hand it to Telegram → receive a weather-triggered Plan B → split into subgroups → reunite at a shared rendezvous → download an offline trip summary.

### Phase 0 — Foundation, architecture, and handoff

- Create a monorepo with `web/` for Next.js and `api/` for FastAPI + aiogram.
- Provision PostgreSQL with PostGIS for trips, people, itinerary locations, group membership, branch membership, preferences, dietary/accessibility requirements, contingencies, and packing items.
- Add Redis for Telegram callback deduplication, short-lived web-to-bot handoff tokens, weather-response caching, and background-job state.
- Use a short-lived signed opaque token for web-to-bot handoff:
  - Web calls `POST /trips/{tripId}/handoff`.
  - API returns `https://t.me/<bot>?start=handoff_<token>`.
  - `/start` verifies and consumes the token, binds the Telegram identity to the trip, and confirms activation.
- Define the minimum public API:
  - `POST /trips`, `GET /trips/{id}`, `PATCH /trips/{id}`
  - `POST /trips/{id}/members`
  - `POST /trips/{id}/itinerary/generate`
  - `POST /trips/{id}/handoff`
  - `POST /trips/{id}/branches`, `POST /branches/{id}/join`, `POST /branches/{id}/merge`
  - `POST /trips/{id}/contingencies/evaluate`
  - `GET /trips/{id}/offline-bundle`
- Build typed shared request/response contracts from an OpenAPI specification so the web app and bot use the same trip model.
- Configure a live Telegram webhook bot. Require the bot to be added as a group administrator and document Telegram privacy-mode requirements so it can receive relevant group messages.

## Key implementation changes

### Phase 1 — Web planning portal

- Build a destination/date onboarding flow with:
  - destination and trip dates;
  - budget tier and editable ceiling;
  - travel pace: chill, balanced, or intense;
  - optional accessibility profile, mobility constraints, allergies, dietary restrictions, and halal requirement.
- Build a lightweight travel-preference quiz that outputs a travel archetype and recommendation tags. Present it as a preference game, not a medical or psychological assessment.
- Build itinerary generation that applies hard constraints before recommendations:
  - travel dates and venue hours;
  - total budget and estimated activity cost;
  - daily activity count and exertion limit based on selected pace;
  - dietary/allergy and accessibility suitability;
  - weather compatibility and a fallback activity for each outdoor itinerary node.
- Implement discovery using Open-Meteo and OpenStreetMap/Overpass, with curated seed POIs for the chosen demo destination to ensure the experience remains reliable when external data is incomplete.
- Show each proposed place’s approximate cost, exertion level, halal/dietary suitability, accessibility notes, crowd-risk label, and weather fallback.
- Add “Send to Telegram” as the primary completion action.

### Phase 2 — Telegram group coordinator

- Implement `/plan`, `/route`, `/weather`, `/planb`, `/split`, `/merge`, `/food`, `/pack`, and `/offline`.
- Parse only relevant group messages after a group is associated with an active trip:
  - explicit preferences such as “I prefer hiking”;
  - dietary or accessibility needs stated by users;
  - route/activity votes;
  - clear decisions or conflicts.
- Keep message parsing assistive rather than authoritative: the bot displays extracted preferences and requires confirmation before altering shared itinerary state.
- Implement inline keyboard flows for voting, accepting a Plan B, joining a branch, and confirming a rendezvous.
- Implement group splits as parallel itinerary branches with:
  - an origin activity;
  - selected members;
  - a branch-specific route/activity;
  - a mandatory future rendezvous time and location;
  - scheduled reminders before reconvergence.
- Ensure each member can be in only one active branch for a given itinerary time window.

### Phase 3 — Reactive travel intelligence

- Run scheduled weather checks for active trips; increase polling frequency around an active outdoor itinerary item.
- Trigger a contingency when rain probability, storm code, extreme heat, transport delay, or closure threshold is met.
- Rank Plan B candidates with deterministic filters for opening hours, distance, budget, group requirements, and indoor/outdoor suitability; use an LLM only to explain the recommendation in natural language.
- Use deterministic allergy and halal filtering from normalized ingredients, cuisine-risk terms, and venue metadata. Flag results as “requires staff confirmation” when cross-contamination cannot be verified.
- Generate packing/tool lists from expected weather, activities, country plug type, and trip profile. Include medical or accessibility-related preparation only when the traveler explicitly provided that information.
- Calculate crowd warnings from weekday/weekend, public holiday, local event, and POI popularity signals; propose a lower-crowd time or nearby alternative.

### Phase 4 — Offline delivery and deployment

- Generate an offline bundle containing a compact itinerary PDF, GeoJSON/GPX route data, a lightweight HTML summary, emergency contacts, and dietary/allergy translation cards.
- Deliver the bundle through `/offline` in Telegram and cache the latest itinerary in the web app with a service worker and IndexedDB.
- Containerize the API and deploy it to Cloud Run or Railway with managed PostgreSQL, Redis, and S3-compatible storage.
- Deploy Next.js separately with environment-specific API and Telegram bot configuration.
- Protect the live system with webhook secret verification, rate limiting, encrypted/redacted sensitive-profile logging, idempotent job processing, and automatic token expiry.

### Phase 5 — Hackathon demo and polish

- Prepare one curated destination dataset, one planned rain event, two conflicting group preferences, and at least one allergy/halal constraint.
- Demonstrate the full flow:
  1. Set destination, date, budget, pace, and accessibility/dietary needs on the website.
  2. Complete the preference quiz and generate an itinerary.
  3. Hand off the trip to a real Telegram group.
  4. Show members expressing conflicting interests.
  5. Trigger a weather alert and accept an indoor Plan B.
  6. Split the group, show routes, then confirm the rendezvous.
  7. Send the offline bundle.
- Keep the pitch centered on: “Plan once, coordinate as a group, and adapt instantly when reality changes.”

## Test plan

- Unit-test budget calculations, pace limits, risk scoring, branch membership constraints, Plan B eligibility, and packing rules.
- Integration-test token handoff, Telegram webhook authentication, group-message extraction confirmation, weather-triggered contingency selection, and offline bundle generation.
- Validate that:
  - an outdoor activity receives an actionable fallback during heavy rain;
  - groups can branch and later merge without duplicate membership;
  - severe allergies block unsafe suggestions and prompt staff confirmation;
  - halal-only preferences remove incompatible recommendations;
  - a trip remains usable from the delivered offline package when connectivity is absent;
  - unconfirmed chat interpretation cannot silently overwrite group plans.

## Assumptions and defaults

- The MVP is greenfield; the repository currently contains no application scaffold.
- The demo uses a real Telegram group and a deployed webhook bot.
- Open-Meteo and OSM/Overpass provide live data; curated seed data guarantees the demo path.
- PostgreSQL, Redis, object storage, and API keys are available through managed/free-tier services.
- Accessibility, disability, allergy, and halal data are optional, user-provided, and used only to tailor recommendations; the product does not provide medical or food-safety guarantees.
