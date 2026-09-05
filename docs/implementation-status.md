# WanderSync Implementation Status

> Snapshot: 2026-09-05. `Implementation_Plan.md` remains the binding specification. This file
> records what the repository currently implements so the next development agent can select work
> without relying on the plan's stale checkboxes.

<!-- AUTO-GENERATED: implementation status derived from repository source and tests -->

## Status definitions

- **Delivered** — the planned user behavior and its main automated tests exist locally.
- **Partial** — a meaningful slice exists, but one or more acceptance requirements are missing.
- **Not started** — no production implementation of the task exists. Types, placeholders, old
  schema, or adjacent pure helpers do not count as delivery.
- **External verification pending** — implementation exists locally but has not passed the required
  hosted or multi-session check.

## Executive summary

| Area | Status | Summary |
| --- | --- | --- |
| Delivered foundation | Delivered locally | Auth, trip CRUD, Gemini itinerary proposals, deterministic schedule validation, proposal confirmation, RLS, revisions, and rate reservations. |
| Phase 1: preferences and safety | Partial | Full typed constraint schema (dietary/religious_access/mobility), `traveler_profiles`, and `poi_catalog` with RLS now exist, with a first researched-and-cited batch of 14 (of 40-50) seed POIs. Context extraction, hybrid preference signals, the compact survey, and the deterministic hard-constraint gate do not yet exist. |
| Phase 2: optimizer and ledger | Not started, except math helper | No Python service, optimizer client, Knapsack solver, Redis integration, or receipt ledger persistence. |
| Phase 3: collaborative workspace | Partial, substantial | Jigsaw engine, chat, assistant proposals, responsive workspace, and persistent timeline drags exist. Presence, confirmation wiring, PWA behavior, and some synchronization details remain. |
| Phases 4–9 | Not started | Routing, split/merge execution, serendipity, on-site tools, self-healing, VQA, deployment, and full demo path remain. |
| Phase 10: Android companion | Conditional, not started | Post-web Kotlin/Compose companion. It starts only after Phase 9, one stable API release, and demonstrated user demand. |

## Baseline and repository gates

| Item | Status | Existing evidence | Remaining work |
| --- | --- | --- | --- |
| Supabase auth and protected routes | Delivered | `middleware.ts`, `lib/supabase/*`, `app/login`, and auth tests. | Hosted authentication smoke test is still part of the live gate. |
| Trip create/load/edit | Delivered | `lib/repositories/supabase-trip-repository.ts`, trip API routes, and repository/API tests. | Complete the hosted create-to-reload journey. |
| Gemini itinerary proposal | Delivered | `lib/gemini/*`, `lib/services/trip-proposals.ts`, proposal routes and tests. | Verify once against a real Gemini project without recording sensitive prompts. |
| Pending proposal confirmation | Delivered | SQL proposal RPCs, review UI, revision checking, and migration tests. | Race acceptance in separate real database sessions. |
| Hosted create → generate → confirm → reload | External verification pending | Mocked browser flow and local database tests exist. | Run the exact journey against a disposable Supabase project and real Gemini. |
| Multi-role HTTP RLS matrix | External verification pending | Hosted SQL role matrix is documented in `tests/database/live-rls.md`. | Exercise owner, planner, member, viewer, unrelated, anonymous, and service credentials through PostgREST/HTTP. |
| Retire `codex/phase-0-1` | Not done | Both local and `origin/codex/phase-0-1` branches still exist. | Delete/abandon the branch only when explicitly authorized; do not merge the Telegram work. |
| GitHub Actions CI | Not started | No `.github/workflows/ci.yml`. | Add Node and future Python verification gates. |
| Remove old `web/` scaffold and direct Phoenix dependency | Delivered | No `web/` directory and no direct `@supabase/phoenix` dependency. | Update the stale checkbox in the binding plan when plan status is reconciled. |
| Local verification | Delivered | On 2026-09-05: 494 Vitest tests, 4 Playwright browser tests (desktop + mobile), `tsc --noEmit`, `eslint`, and `next build` all passed. | Re-run before relying on this if the harness or dependencies change. |

## Phase 1 — Intent, preferences, and hard constraints

### Task 1.1 — Constraint and profile schema: Partial (schema/RLS delivered, seed data partial)

Implemented 2026-09-05:

- `trip_constraints` table, confirmed-only enforcement view, trip-scoped RLS, and revision bump
  (pre-existing), now extended to all three kinds: `202609050006_traveler_profiles_poi_catalog.sql`
  drops the dietary-only scope lock and adds typed flag-vocabulary checks for `religious_access`
  (`modest_dress_required`, `prayer_space_needed`, `no_alcohol_venues`, `other`) and `mobility`
  (`wheelchair_accessible_required`, `limited_walking_distance`, `no_stairs`, `other`).
- `traveler_profiles`: `interest_vector vector(64)`, budget caps, `pace` (reuses the existing
  `pace_level` enum), `mobility_threshold_m`, `serendipity_epsilon` (0.0-0.3), private `social_role`.
  RLS is self-read-only — not even the owner/planner can read another member's row (`social_role`
  has no carve-out); owner/planner may write on a member's behalf, matching `trip_constraints`'
  existing on-behalf pattern.
- `poi_catalog`: PostGIS `geography(Point,4326)`, `vector` extension enabled, typed `cost_tier`
  (includes `free`, distinct from the trip-level `budget_tier` enum), `halal_status`,
  `allergen_risk` + an explicit `allergen_data_unknown` boolean (uncertain data must read as
  unknown, never as "confirmed safe"), `dress_code`, `tourist_density`, `landmark_class`, and
  provenance columns (`source_url`, `source_note`, `verified_at`) beyond Section VI's base column
  list. Shared reference data, not trip-scoped: read-only to `authenticated`, write-only via
  `service_role` (the seed script), unique on `(name, region)` for idempotent upserts.
- `lib/domain/constraints.ts` extended with the religious_access/mobility flag enums, Zod schemas,
  labels, and default-severity helpers (existing dietary exports untouched).
- `tests/database/constraints-rls.test.ts` (new, 14 tests): dietary self-write, owner/planner
  on-behalf write, all-flag DB-level validity, unlisted-flag rejection, member read-all for
  constraints, unrelated denial, unconfirmed-row exclusion, traveler_profiles self read/write,
  on-behalf write, cross-member read denial (including owner), unrelated denial, epsilon bounds,
  and poi_catalog read-all/write-denied. `tests/domain/constraints.test.ts` extended for the new
  flag types. **Note:** `trip_constraints`/dietary had zero RLS test coverage before this change,
  despite the migration predating it — Task 1.1's checklist item covers that pre-existing gap too.
- `@electric-sql/pglite-postgis` and `@electric-sql/pglite-pgvector` added as devDependencies so
  the local PGlite harness can run `create extension postgis`/`vector`; `tests/database/
  migrations.test.ts`'s shared PGlite instance updated to load both, since it runs every migration
  file in sequence.
- Seed infrastructure: `scripts/seed_kl_reference.ts` (Zod-validated, idempotent upsert via
  `service_role`, `npm run seed:kl-reference`), `supabase/seed.sql` (shells out to it on local
  `supabase db reset`, skips quietly if `SUPABASE_SERVICE_ROLE_KEY` is unset), and
  `docs/research/kl-reference-poi-review.md` documenting the sourcing methodology and a per-row
  citation for every seeded POI.

Missing:

- **Seed data is 22 of the target 40-50 rows** (6 KLCC, 5 Bukit Bintang, 11 Old Town/Melaka).
  Each row is individually web-researched and cited (official venue sites, Wikipedia infobox
  coordinates, JAKIM's own Halal Hub statement for the one verified-halal food entry) rather than
  bulk-generated, per explicit instruction to prioritize accuracy over hitting the count. A second
  research pass initially turned up several well-documented venues outside the three named
  regions (Petaling Street, Central Market, Sri Mahamariamman Temple, a Jalan Tanglin restaurant)
  and discarded all of them for region fit rather than stretching the corridor definition.
  `docs/research/kl-reference-poi-review.md`'s "Next steps" section names specific venues to
  research next in the same pattern. Do not pad this by inventing plausible-sounding halal/allergen
  data — mark uncertain fields `unknown`, as several rows already do for mixed food streets and
  two restaurants with only secondary-source (non-authoritative) halal claims.
- The seed script has not been run against a real Supabase project (needs a real
  `SUPABASE_SERVICE_ROLE_KEY`; validated so far only via Zod parsing and a dummy-key dry run that
  correctly reached the network call).
- Database support for the new `trip_interest_signals` hybrid-preference model (this is Task 1.2's
  own migration, not Task 1.1's).

### Task 1.2 — Contextual discovery and candidate-constraint extraction: Not started

Missing:

- Incremental extraction from trip chat and ingestion of pasted text, voice, and public-link captions.
- Structured `discoverySignals[]` and `candidateConstraints[]` output with Zod validation.
- Allowlisted tags, moment/day/trip expiry, deduplication, dismissal, and source explanations.
- Connections from active signals to attraction search, itinerary variants, detours, weather
  alternatives, and split suggestions.
- Per-user/per-trip ingestion rate limits and prompt-injection tests.

### Task 1.3 — Confirmation and interest-vector build: Partial

Implemented:

- Tapping a manual dietary flag immediately writes a confirmed constraint for the current member.

Missing:

- Candidate-constraint Confirm / Edit / Reject review UI.
- Affected-member rules for severe inferred constraints and on-behalf actor logging in that flow.
- Deterministic explicit survey vector, separate contextual vector, and read-time weighting.
- Signal expiry/dismissal behavior and tests proving inference cannot overwrite the survey baseline.

### Task 1.4 — Hard-constraint gate: Not started — highest-priority blocker

Missing:

- The pure `pass | warn | fail` gate for dietary, halal, dress code, budget, mobility, and time.
- Fail-closed handling for unknown allergen/halal data when severity is severe.
- Integration into the existing Gemini proposal-validation path.
- Exhaustive decision-table tests.

Do not treat the current schedule/budget-tier validation as this gate. It does not enforce the new
confirmed constraint model against verified POI safety data.

### Task 1.5 — Blind preference alignment: Not started

Missing:

- Redis ballot storage, per-session salt, TTL, and overwrite semantics.
- Conservative lowest-budget reducer and private dislike filtering.
- Aggregate-only assistant wording and non-reconstruction tests.

### Task 1.6 — Compact preference survey: Not started

Missing:

- Five one-question screens, under-60-second target, and Quick mode.
- Explicit baseline writes for vibe, constraints, pace, budget, social role, and surprise tolerance.
- Private social-role access control, overwrite behavior, and Group Conductor summary.
- Clear separation preventing chat-derived signals from modifying survey fields.

### Phase 1 completion gate

Claude should not mark Phase 1 complete until the survey baseline, contextual signals, constraint
review, POI reference data, and deterministic safety gate work together. The acceptance path must
show that a live-jazz message changes attraction ranking while a severe peanut constraint still
rejects an unsafe or unknown food POI.

## Phase 2 — Optimization service and budget scheduling

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 2.1 Python optimization service | Not started | FastAPI `/healthz`, token middleware, versioned Pydantic models, stateless-dependency CI rule, Python quality gates, Dockerfile, and Compose. |
| Task 2.2 Next.js optimizer client | Not started | Bidirectional Zod validation, anonymized payload builder, hard timeout, stable error mapping, and fake-server tests. |
| Task 2.3 Multi-objective Knapsack | Not started | OR-Tools scheduler, cap/slack outputs, deterministic seed, gate pass, and pending-proposal route. |
| Task 2.4 Receipt-OCR ledger | Partial foundation only | `lib/domain/debt-simplify.ts` implements equal splitting, balances, and simplified transfers. Expenses tables/RLS, OCR, confirmation, weighted/subgroup splitting, reversals, and ledger UI/API are missing. |

## Phase 3 — Collaborative workspace

### Task 3.0 — Bargaining engine and jigsaw panel: Delivered with addenda outstanding

Implemented:

- Anchor partitioning, Pareto filling, round-robin veto, split-cut decision, minimax regret,
  30-minute snapping, magnetic anchors, conflict detection, trilemma options, debt simplification,
  jigsaw panel, satisfaction meters, and split suggestions.
- Persistent revision-checked drags were subsequently implemented under Task 3.4.

Missing addenda:

- Multiplayer presence cursors during a drag.
- Per-member regret weights sourced from onboarding.

### Task 3.1 — Chat persistence and Realtime transport: Delivered locally

Implemented:

- Append-only `chat_messages` with author kind, optional proposal link, RLS, and grants.
- Trip-channel insert subscription, chronological repository reads, reconnect backfill, and polling
  fallback.
- Repository, channel, component, and migration tests.

Remaining verification:

- Validate actual hosted Supabase Realtime delivery and RLS behavior with multiple authenticated
  sessions.

### Task 3.2 — Chat UI, presence, and avatars: Partial

Implemented:

- Author name/initial, timestamp, consecutive-message grouping, optimistic send, failed-send retry,
  status feedback, and accessible message/composer primitives.
- Presence bar rendering from received presence state.

Missing:

- The client never publishes its own presence with `channel.track(...)`, so real join/leave presence
  is not fully wired.
- Actual profile avatar images; the current UI uses colored initials.
- Complete hosted join/leave and reconnect verification.

### Task 3.3 — Embedded AI assistant: Partial, substantial

Implemented:

- `@ai` addressing, bounded 20-message context, untrusted-input system instruction, structured
  Gemini response, plain assistant messages, pending itinerary proposal cards, and owner-only
  activation through the existing proposal path.
- Generation reservation is reused for rate limiting.

Missing or unresolved:

- A dedicated assistant composer entry point.
- Confirm the intended authorization: UI permits any member to ask, but `reserve_generation` is
  documented as owner/planner-only, which may reject ordinary members.
- Hosted prompt-injection and cross-trip isolation validation.

### Task 3.4 — Persist and synchronize jigsaw drags: Partial, near complete

Implemented:

- Multi-day columns, same-day and cross-day dragging, optimistic state, server-side date/overlap/
  midnight validation, revision conflict handling, rollback reason, and remote refetch after trip
  revision changes.

Missing:

- Designed animation of remote changes rather than an immediate refetch replacement.
- Complete visual states for active, pending proposal, AI-suggested, and conflicted cards.
- Full specified test matrix, including two-member collision behavior and remote animation.

### Task 3.5 — Workspace shell and confirmation primitive: Partial

Implemented:

- Dual-pane shell, responsive tab collapse, full-screen jigsaw toggle, and a pure actor-bound,
  expiring, single-use confirmation-token state machine with unit tests.

Missing:

- Persistent/server-backed confirmation tokens and integration across later mutating workflows.
- Active-focus event bus between chat/proposal cards and the future map.
- Touch arbitration between map and chat gestures.
- PWA offline itinerary snapshot and emergency-contact/allergy-card caching.
- The actual Google Maps JavaScript API map; the current map slot renders the timeline pane.

## Phase 4 — Group routing, split/merge, and mobility

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 4.1 Traveler clustering | Not started | Seeded K-Means/GMM, branch weights, single-cluster fallback, and tests. |
| Task 4.2 m-VRPTW routing | Not started | OR-Tools time-window routes, supplied travel matrix, consensus anchor, arrival/slack output, and infeasibility tests. |
| Task 4.3 Split/merge flow | Not started | Subgroup schema/RLS, human-editable proposed branches, micro-zone split, mission metadata, ETA guidance bands, confirmation, and budget gates. |
| Task 4.4 Multi-modal mobility | Not started | Ride-hail/transit break-even, Fastest/Budget/Scenic options, rain pivot, and tests. |

The current jigsaw can recommend a split, but it cannot create, route, activate, monitor, or merge
real subgroup sessions.

## Phase 5 — Serendipity and exploration

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 5.1 Epsilon-greedy recommender | Not started | Combined survey/context ranking, exploration sampling, hard-gate filtering, diversity, history dedupe, seeded tests. |
| Task 5.2 Safe / Local / Wildcard | Not started | Three constraint-safe pending variants, workspace switcher, diversity comparison, and tests. |
| Task 5.3 Spontaneous detours | Not started | DAG buffer detection, PostGIS proximity scan, recent-signal ranking, proposal card, solver reflow, dismiss suppression, and tests. |

## Phase 6 — On-site execution

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 6.1 3D landmark navigation | Not started | Google Maps JavaScript vector/3D map with 2D fallback, deterministic owned-catalog landmark prefilter, grounded Gemini cues, camera/turn behavior, provider attribution/content-boundary checks, and hallucination tests. |
| Task 6.2 Photo and lighting | Not started | Sun solver, golden/blue-hour windows, stand-here coordinates, framing guide, scheduler preference, and reference tests. |
| Task 6.3 Packing checklist | Not started | Forecast/UV ingestion, dress-code items, bilingual offline allergy card, service-worker/local fallback, shared claims, and tests. |

## Phase 7 — Environmental self-healing

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 7.1 Trigger monitors | Not started | Rain, budget-overrun, and detour monitors; debounce; trip lock; concurrency tests. |
| Task 7.2 DAG retopology | Not started | Minimal-diff reoptimization, locked nodes, indoor/weather substitution, free-tier budget recovery, latency budget, and tests. |
| Task 7.3 Confirmation-first healed plan | Not started | Realtime banner/card, inactive-until-confirmed apply, rejection behavior, `heal_events`, and atomic tests. |

## Phase 8 — Multimodal on-site VQA

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 8.1 Food allergen VQA | Not started | Structured food analysis, deterministic severe-allergen overlay, low-confidence posture, disclaimer, and tests. |
| Task 8.2 Heritage architecture VQA | Not started | Structured style/history result, POI enrichment, honest unknown behavior, and anti-fabrication tests. |
| Task 8.3 VQA safety review | Not started | Non-downgrade audit, rate limits, EXIF stripping, image RLS, and documented fail-safe behavior. |

## Phase 9 — End-to-end, deployment, and demo

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 9.1 Full-lifecycle acceptance | Not started | Two-browser ingest → confirm → schedule → explore → split → heal → merge → VQA → ledger automation. |
| Task 9.2 Deployment readiness | Not started | Public browser-restricted and private server Google key contracts, API restrictions/quotas/budget alerts, optimizer isolation, both health endpoints, safe structured logs, Realtime quotas/origins, production smoke test, and CI. |
| Task 9.3 Demo | Not started | Scripted sub-three-minute reference journey demonstrating the plan's major differentiators. |

## Phase 10 — Conditional post-web Android companion

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 10.1 Mobile API contract hardening | Not started | Versioned HTTPS contracts, shared schema/fixtures, idempotent mutations, auth/Realtime documentation, and TypeScript/Kotlin contract tests. |
| Task 10.2 Android foundation and offline architecture | Not started | Kotlin/Compose project, clean module boundaries, Hilt, coroutines/Flow, Room snapshot, secure auth storage, and Android CI. |
| Task 10.3 Android companion MVP | Not started | Active trip, offline itinerary/allergy card, chat, proposal cards, split/merge status, reconnect behavior, and accessibility/process-death tests. |
| Task 10.4 Native on-trip capabilities | Not started | Confirmed camera uploads, privacy-safe notifications, opt-in split-session location, permission/battery/background tests. |
| Task 10.5 Android planning parity decision | Not started and intentionally deferred | Use companion telemetry/interviews to decide whether full creation, questionnaire, jigsaw, and native Google Maps SDK 3D/map parity justify separate work. |

Phase 10 must not be selected merely because it is documented. Its start gates are Phase 9 passing
in a production-like environment, one stable contract release, and evidence of mobile demand.

## Recommended next execution order

1. ~~Fix the browser harness regression so the baseline verification command is trustworthy.~~ Done
   2026-09-05: `tests/browser/vite.config.ts` now defines `process.env.NODE_ENV` (Next's webpack
   build does this automatically; the bare Vite harness did not), and the login test's ambiguous
   button locator was narrowed. 471 Vitest + 4 Playwright tests + typecheck all green.
2. Task 1.1: schema, RLS, and seed infrastructure done 2026-09-05. Remaining: grow the reference
   seed past 14 rows toward 40-50 using the same per-venue web-research-and-cite pattern in
   `docs/research/kl-reference-poi-review.md`, then run `npm run seed:kl-reference` against a real
   Supabase project once `SUPABASE_SERVICE_ROLE_KEY` is available. (`trip_interest_signals` is
   Task 1.2's own migration, not part of this task.)
3. Implement Task 1.4's hard-constraint gate and wire it into existing Gemini validation before
   exposing any new attraction recommender.
4. Implement the compact survey portion of Task 1.6 and the candidate confirmation UI in Task 1.3.
5. Implement Task 1.2 contextual chat extraction, expiry/dismissal, and the separate contextual
   vector. Demonstrate that inference changes ranking but never changes confirmed facts.
6. Finish Task 3.2 presence and Task 3.5 confirmation/focus/touch gaps; resolve ordinary-member
   assistant authorization in Task 3.3.
7. Close hosted auth, PostgREST RLS, Realtime, race, and create-to-reload baseline checks; add CI.
8. Build Phase 2's stateless optimizer boundary and Knapsack scheduler.
9. Continue in dependency order: Phase 4 routing → Phase 5 discovery → Phase 6 on-site tools →
   Phase 7 healing → Phase 8 VQA → Phase 9 acceptance/deployment/demo.
10. After the explicit Phase 10 start gate, harden shared client contracts before creating the
    Android project; then ship the focused companion before considering planning/map parity.

## Instructions for the next agent

- Read `Implementation_Plan.md` for acceptance details; use this file only to select unfinished work.
- Re-inspect the referenced source before editing because this is a point-in-time status snapshot.
- Preserve existing delivered behavior and tests; do not rebuild the Phase 0/1 foundation.
- Use test-first changes and update this status file only after the relevant tests and verification
  gates pass.
- Never mark hosted, multi-session, Realtime, or provider behavior complete using mocks alone.
- Never allow LLM output or chat inference to bypass confirmation or the deterministic hard-
  constraint gate.
- Do not start Android implementation before Phase 10's gates. Mobile clients share versioned
  contracts and server behavior, not React UI code or duplicated safety/optimization logic.

<!-- END AUTO-GENERATED -->
