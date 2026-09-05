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
| Phase 1: preferences and safety | Partial | Full typed constraint schema, `traveler_profiles`/`poi_catalog` with RLS, 24 (of 40-50) researched-and-cited seed POIs, the deterministic hard-constraint gate (wired into Gemini proposal validation), and constraint-aware POI grounding (Task 1.1/5.x pulled forward) now exist -- live-verified both blocking (no verified venue) and succeeding (a verified venue exists). Context extraction, hybrid preference signals, the compact survey, and pre-generation daily planning windows do not yet exist. Gate `warn`s are computed but not yet surfaced in the UI; `claimed`-status venues cannot yet be safely suggested pending that UI. |
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

### Task 1.4 — Hard-constraint gate: Delivered and hosted-verified, with two documented scope limits

Live-verified 2026-09-05 against the hosted Supabase project (not just PGlite): an unconstrained
trip generates a proposal successfully (201). A confirmed `halal` constraint's outcome now depends
on real `poi_catalog` grounding data (see "POI resolution and safety grounding" below) rather than
always refusing -- both outcomes are live-verified.

Implemented 2026-09-05:

- `lib/domain/constraint-gate.ts`: pure `evaluateConstraintGate(item, confirmedConstraints,
  travelerCaps)` -- no I/O, no clock reads. Covers all six Section VII dimensions: dietary
  (allergen match against `allergen_risk` fails regardless of severity; unknown allergen data
  fails closed for severe flags, warns otherwise), halal (verified passes, claimed warns,
  unknown/no fails), dress code (a `modest` requirement always warns -- "never silently
  scheduled"), budget (item cost vs. each traveler's precomputed remaining headroom), mobility
  (leg distance vs. threshold, fail if a severe mobility constraint is confirmed, warn otherwise),
  and time (overlap/midnight/consensus-anchor flags, precomputed by the caller from full-schedule
  context). 35 exhaustive table tests in `tests/domain/constraint-gate.test.ts`.
- Wired into `lib/domain/gemini-proposal-validation.ts`: the gate is now the single authority for
  overlap/midnight decisions too (replacing a second, separate implementation of the same checks),
  plus the new dietary/halal enforcement. A `fail` throws `GeminiProposalValidationError` (blocks
  the whole proposal, matching today's all-or-nothing behavior); a `warn` is collected into the
  function's new return shape (`{ proposal, gateWarnings }`) but does not block. Since a
  Gemini-authored activity has no `poi_catalog` link yet, every `food`-category activity is
  conservatively treated as `halalStatus: "unknown"` / `allergenDataUnknown: true` -- this
  correctly fails closed whenever a severe dietary constraint is confirmed for the trip, which is
  the safety-critical behavior the plan repeatedly emphasizes.
- `TripRepository` gained `listConfirmedConstraints` and `listTravelerCaps`; `generateProposal`
  fetches both before validating. `listTravelerCaps` calls a new security-definer function,
  `trip_member_budget_mobility_caps` (migration `202609050007_traveler_caps_view.sql`), because
  Task 1.1's `traveler_profiles` RLS is deliberately self-read-only to protect `social_role` --
  a plain view would have been re-filtered by that same restrictive policy and returned nothing
  for other members. The function bypasses per-row RLS but projects only the four numeric-cap
  columns the gate needs, never `social_role`/`pace`/`interest_vector`. 2 new RLS/contract tests
  cover group-wide read and non-member denial.
- 4 new tests in `tests/domain/gemini-proposal-validation.test.ts` prove the end-to-end wiring:
  a severe allergen fails closed on a food activity, a non-food activity is unaffected, a
  standard-severity match warns without blocking, and confirmed halal without a verified status
  fails closed.

Two scope limits, both deliberate and documented in code comments (not silently under-built):

- **Per-item numeric Budget/Mobility enforcement is inert against live data.** The gate itself
  supports it (see the exhaustive tests, which use synthetic numbers), but the current wiring
  passes `remainingBudget: null` and `legDistanceM: null` for every real activity, because Gemini
  activities carry only a cost *tier* (no numeric estimate) and no leg-distance data -- inventing
  a tier-to-currency conversion table would be exactly the kind of fabricated number this project
  has been avoiding. This becomes real once Task 2.3's Knapsack pricing and POI-linked distances
  exist.
- **Gate `warn`s are computed but not yet surfaced to a human reviewer anywhere in the UI.** They
  are returned from `validateGeminiProposal` and simply not read further today. A follow-up should
  either display them on the proposal review UI or fold them into the assistant-proposal-card flow
  -- not required by Task 1.4's own checklist, but worth closing before Phase 1 exit.
- **Vegetarian/vegan/other dietary flags are not enforced by this gate.** Section VII's Dietary
  rule only names "an allergen flag," not the full dietary vocabulary; enforcing vegetarian/vegan
  would need `poi_catalog` to carry a distinct meat/dairy-content fact it does not have. Documented
  in the gate's own source and covered by an explicit test asserting the current (non-)behavior.

### Task 1.1/5.x pulled forward — POI resolution and safety grounding: Delivered and hosted-verified

Directed 2026-09-05: proposal validation is all-or-nothing, so a Gemini food activity with no
verified safety link was rejecting every proposal for a halal/severe-allergen-confirmed trip, not
just the unsafe item. POI resolution was pulled forward ahead of the broader Task 5.x discovery
engine to fix this.

- `lib/domain/poi-resolution.ts`: `inferPoiRegion()` maps a free-text destination to one of the
  three reference-corridor regions (KLCC / Bukit Bintang / Old Town-Melaka) or `null` elsewhere;
  `matchPoiByName()` deterministically matches a Gemini-written activity title against the trip's
  candidate POIs (conservative one-directional substring match on a parenthetical-stripped core
  name, ignoring names too short to be a meaningful signal); `filterCandidatePoisForConstraints()`
  narrows the candidate list down to only what's safe to *suggest* to Gemini given the trip's
  confirmed constraints. 33 tests in `tests/domain/poi-resolution.test.ts`.
- `lib/services/trip-proposals.ts`'s `generateProposal` fetches confirmed constraints first, then
  the region's full candidate POIs, then computes a **filtered** hint list for the Gemini planner
  (which never sees a venue the constraint already rules out) while still validating every activity
  against the **full, unfiltered** candidate list -- so the gate remains the sole authority on
  safety and the hint is only ever a suggestion, never a trust boundary.
- Constraint-aware hint filtering (directed 2026-09-05, after live testing showed adding more
  `claimed` POIs alone did not help -- Gemini tends to use every named candidate across a trip's
  meal slots rather than picking only the safe ones): for a confirmed `halal` constraint, only
  `halal_status: "verified"` venues are suggested (`claimed` is excluded until a warn-and-confirm
  UI exists to surface it safely); for a confirmed **severe** allergen constraint, venues with
  `allergen_data_unknown: true` or a matching `allergen_risk` entry are excluded. The two filters
  are independent (a confirmed allergen alone never narrows by halal_status and vice versa), and a
  standard-severity allergen constraint does not filter the hint, matching the gate's own warn-only
  treatment at that severity. If filtering leaves no eligible venue, no hint is sent at all rather
  than a fallback venue being invented -- Gemini then names an unlinked venue on its own, which
  correctly fails the gate closed with a clear reason, never a silently-trusted guess.
- `lib/gemini/trip-planner.ts`'s system instruction conditionally names the filtered candidate
  venues for food activities when any exist, without revealing why they were chosen.
- Live-verified against the hosted Supabase project 2026-09-05, both outcomes: the reference
  Melaka demo trip (confirmed `halal`) still correctly refuses (422) because Melaka's seeded
  catalog has zero `verified` halal venues (Nancy's Kitchen: `unknown`; Seri Nyonya Restaurant and
  The Daily Fix: `claimed`) -- an accurate, not overcautious, result. A fresh Bukit Bintang trip
  with confirmed `halal` succeeded (201): Gemini's only food activity named the region's one
  `verified` venue (OldTown White Coffee), matched, and passed the gate.
- POI catalog grew from 22 to 24 rows (`docs/research/kl-reference-poi-review.md`,
  `scripts/seed_kl_reference.ts`): Seri Nyonya Restaurant and The Daily Fix, both Melaka,
  `claimed` halal per multiple independent unofficial sources. Two further Jonker Street
  candidates (Jonker 88, Cottage Spices) were researched and explicitly excluded -- one has
  direct evidence against the popular halal claim (a dedicated JAKIM-portal-checking source found
  no certificate), the other has self-contradicting sources -- see the review doc's "Discarded
  halal claims" note.
- Two pre-existing migration bugs found and fixed while seeding: `202609050006`'s blanket
  `revoke all ... from service_role` on `poi_catalog` never granted write access back
  (`202609050008` fixes this), and `202609030004`'s equivalent revoke on `ordinary_trim(text)`
  (used by `poi_catalog`'s own check constraint) had the same gap (`202609050009` fixes this).
  Neither was caught by the PGlite test harness, since it runs migrations as a superuser, not as
  `service_role`.
- `202609050010_dev_generation_rate_limit_exemption.sql`: exempts the seeded `dev_test@gmail.com`
  account from `reserve_generation`'s anti-abuse rate limit (3 reservations per trip per 10
  minutes, 5 per user per hour), so manual testing isn't throttled. A literal-email carve-out in a
  security-definer function, acceptable only because this project has no real users yet -- remove
  before any production launch.

Remaining: a warn-and-confirm UI so `claimed` (not just `verified`) halal venues can be safely
suggested and accepted with an explicit warning shown to the user; more `verified`-tier POI
coverage (Melaka currently has none); non-reference-corridor destinations still get no grounding
at all, by honest design, not a bug.

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
- Always-available post-onboarding preference editor with revision-checked individual-field updates.
- Safety-edit confirmation and supersession audit trail, privacy-safe Realtime notice, and immediate
  review marking for affected active items.
- Future-only application versus a user-requested, confirmable current-itinerary diff; neither path
  may silently rewrite the active itinerary.

### Task 1.7 — Daily planning windows before generation: Not started

Missing:

- Destination-local per-day `available_from`, soft `preferred_start`, and optional hard
  `finish_by` persistence with RLS and revision checks.
- Preset/custom time controls, copy-to-all-days, visible defaults, and pre-generation validation.
- Group hard-availability intersection, soft-preference explanations, and confirmable early-bird
  branch suggestions.
- Propagation into the scheduler/router plus timezone, infeasibility, and authorization tests.

### Phase 1 completion gate

Claude should not mark Phase 1 complete until the survey baseline, contextual signals, constraint
review, POI reference data, daily planning windows, and deterministic safety gate work together.
The acceptance path must show that a live-jazz message changes attraction ranking while a severe
peanut constraint still rejects an unsafe or unknown food POI, that a later soft-preference edit
changes future suggestions without mutating the active itinerary, and that generation respects
each day's hard time bounds while explaining a material deviation from the preferred start.

## Phase 2 — Optimization service and budget scheduling

| Task | Status | Remaining work |
| --- | --- | --- |
| Task 2.1 Python optimization service | Not started | FastAPI `/healthz`, token middleware, versioned Pydantic models, stateless-dependency CI rule, Python quality gates, Dockerfile, and Compose. |
| Task 2.2 Next.js optimizer client | Not started | Bidirectional Zod validation, anonymized payload builder, hard timeout, stable error mapping, and fake-server tests. |
| Task 2.3 Multi-objective Knapsack | Not started | OR-Tools scheduler, cap/slack outputs, daily hard-window packing, soft preferred-start penalty/explanation, deterministic seed, gate pass, and pending-proposal route. |
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

- The newly specified Calendar-style vertical 24-hour view, collapsed overnight presentation,
  duration-proportional vertical geometry, 15-minute pointer/keyboard resizing, explicit travel
  blocks, and locked-anchor unlock/confirmation flow.
- Revalidation of resize operations against opening hours, transit time, daily planning windows,
  pace, budget, and rendezvous deadlines; existing persistence covers movement only.
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
3. Task 1.4's hard-constraint gate done 2026-09-05: pure gate, 35 tests, wired into Gemini
   proposal validation (fails closed on unknown allergen/halal data). Task 1.1/5.x's POI
   resolution and constraint-aware safety grounding was then pulled forward (see that task's own
   section above) once live testing showed the gate blocked every food activity for any
   halal/severe-allergen-confirmed trip, not just unsafe ones. Migrations `202609050006` through
   `202609050010` are applied to the hosted Supabase project and verified live, both outcomes: an
   unconstrained trip generates successfully (201); a halal-confirmed trip generates successfully
   (201) when a `verified` venue exists in its region (Bukit Bintang) and correctly refuses (422)
   when only `claimed`/`unknown` venues exist (Melaka) -- an accurate result of the catalog's real
   coverage, not a bug.
   Remaining: surface gate `warn`s in the proposal review UI; a warn-and-confirm flow so `claimed`
   halal venues can be suggested and accepted safely; wire real numeric cost/distance data once
   Task 2.3 exists, so Budget/Mobility per-item enforcement stops being inert; grow `verified`-tier
   POI coverage, especially for Melaka, which currently has none.
4. Implement Task 1.7's pre-generation daily planning windows, then the compact survey portion of
   Task 1.6 and the candidate confirmation UI in Task 1.3.
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
