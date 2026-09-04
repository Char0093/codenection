# WanderSync — Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Keep TDD, review gates, and verification evidence with every task. This document is the binding specification and **replaces the earlier narrowed "travel planner MVP" plan**. Where `docs/` files conflict with this plan, this plan wins; the retired scope-lock and the profile/allergen/weather non-goals in older docs are superseded by [Section IX](#ix-data-privacy--safety-appendix).

## What this does

WanderSync is an **end-to-end adaptive collaborative travel system** for group trips. It turns scattered group intent (chat, voice notes, social links) into a validated, budget-bounded, safety-checked itinerary, then keeps that itinerary alive during the trip: it re-optimizes around weather, budget drift, and impromptu detours, coordinates group split-and-merge with real routing math, and gives human-scale on-site help for navigation, photography, and dietary safety.

**Goal:** Deliver a system where an LLM proposes and enriches, deterministic optimization decides what is feasible, and the group explicitly confirms what becomes real — coordinated in a native, multi-user collaborative workspace in the browser.

**Core value:** It systematically resolves the failure modes of existing travel tools — rigid schedules, group compromise fatigue, navigation disorientation, budget drift, and algorithmic echo chambers that over-filter discovery.

**Architecture (hybrid):** A **Next.js / TypeScript** application owns the entire user-facing experience — the collaborative workspace, Supabase auth and data access, Realtime fan-out, LLM/VQA calls, and orchestration. There is no third-party chat platform, bot, or webview in the product. A separate stateless **Python / FastAPI optimization service** owns the operations-research compute: m-VRPTW routing, multi-objective Knapsack scheduling, traveler clustering, astronomical (SunCalc) computation, and DAG itinerary retopology. The Python service holds no credentials beyond a shared secret, never writes the database, and never calls external providers — it receives an anonymized problem payload and returns a solution.

**Tech stack:** Next.js 15 App Router, React 19, TypeScript, Mapbox GL JS (3D extrusion), `lucide-react` icons, pointer-event drag (no drag library: the 30-minute grid and magnetic snapping are custom), and the existing hand-written CSS design tokens in `app/globals.css` (this project does **not** use Tailwind); Supabase Auth / Postgres / PostGIS / pgvector / RLS / **Realtime**; `@google/genai` (Gemini) for intent extraction, VQA, and narration; Zod; Vitest + Playwright. Python 3.12, FastAPI, Google OR-Tools, NumPy / scikit-learn (K-Means, GMM), SunCalc, pytest + ruff + mypy. Redis for ephemeral group location, session state, locks, and a job queue. GitHub Actions CI.

**Control contract (the moat):** Gemini produces candidates, explanations, and alternatives. It cannot activate a plan, spend money, assign people to subgroups, bypass RLS, or mutate state. The Python service can compute an optimal assignment or route but cannot persist or activate it. Every candidate item passes a deterministic hard-constraint gate ([Section VII](#vii-hard-constraint-gate)) before it is stored or shown as approved, and every state change is confirmed by an authorized human.

## Table of contents

- [What this does](#what-this-does)
- [I. Target users](#i-target-users)
- [II. The eleven core modules](#ii-the-eleven-core-modules)
- [II-b. Conflict resolution framework](#ii-b-progressive-conflict-resolution-framework)
- [III. Deep-dive: Module 5 — serendipity & dynamic exploration engine](#iii-deep-dive-module-5--serendipity--dynamic-exploration-engine)
- [IV. End-to-end system architecture](#iv-end-to-end-system-architecture)
- [V. Service boundary](#v-service-boundary-nextjs--python-optimization-service)
- [VI. Persistence model](#vi-persistence-model)
- [VII. Hard-constraint gate](#vii-hard-constraint-gate)
- [VIII. Complete execution lifecycle](#viii-complete-execution-lifecycle)
- [Architectural moats](#architectural-moats)
- [Delivered foundation](#delivered-foundation-do-not-rebuild)
- [Phase 1 — Intent & hard-constraint extraction](#phase-1--intent--hard-constraint-extraction-module-1)
- [Phase 2 — Optimization service boundary & budget scheduling](#phase-2--optimization-service-boundary--budget-scheduling-module-2)
- [Phase 3 — Collaborative workspace: realtime chat & flashcard timeline](#phase-3--collaborative-workspace-realtime-chat--flashcard-timeline-client-layer)
- [Phase 4 — Group routing, split & merge, mobility](#phase-4--group-routing-split--merge-mobility-modules-5--6)
- [Phase 5 — Serendipity & exploration engine](#phase-5--serendipity--exploration-engine-module-5)
- [Phase 6 — On-site execution: navigation, photo, packing](#phase-6--on-site-execution-navigation-photo-packing-modules-3-7-8)
- [Phase 7 — Environmental self-healing](#phase-7--environmental-self-healing-module-9)
- [Phase 8 — Multimodal on-site VQA](#phase-8--multimodal-on-site-vqa-module-10)
- [Phase 9 — End-to-end, deployment, demo](#phase-9--end-to-end-deployment-demo)
- [IX. Data privacy & safety appendix](#ix-data-privacy--safety-appendix)
- [Explicit non-goals](#explicit-non-goals)
- [Verification standard](#verification-standard)

## I. Target users

The reference scenario is a four-person friend group on a 3-day city trip in Malaysia (Kuala Lumpur / Melaka). Each traveler carries a distinct constraint profile, and the trip must serve all of them without forcing majority compromise. This group is used as the fixture for every phase's exit criteria.

### Persona 1: The planner-organizer

**Name:** Amira, 24. **Constraints:** Halal-only, budget-flexible.

**Pain:** She manually reconciles everyone's budget, timing, and dietary limits, then re-explains "the current plan" every time the chat moves on.

**Quote:** "I need one plan everyone agrees on, that updates itself when things change."

### Persona 2: The safety-critical traveler

**Name:** Ben, 23. **Constraints:** Severe peanut allergy, strict budget (RM 150/day).

**Pain:** He wants AI planning help but cannot trust a system that might quietly route the group to a restaurant with cross-contamination risk, or blow his daily cap.

**Quote:** "The allergy rule is not a preference. It must never be traded off."

### Persona 3: The specialist splitters

**Names:** Chloe, 22 (photography, chases golden hour) and Danish, 22 (heritage, student budget RM 150/day).

**Pain:** Their must-see lists barely overlap. Today's tools make them either split with no coordination or stay together and both settle.

**Quote:** "Let us do our own thing for three hours and still make dinner together on time."

## II. The eleven core modules

| Stage | Module | Core functionality & technical implementation | Value proposition |
| --- | --- | --- | --- |
| **Pre-trip** | **1. Intent & hard-constraint extraction** | Ingests group chat text, voice notes, and social media URLs (Instagram, TikTok, Xiaohongshu); parses latent interest vectors; strictly enforces non-negotiables: **Halal compliance** and **food allergens**. | Zero-friction data entry; guarantees critical health and cultural requirements are never violated. |
| | **2. Budget-aware scheduling** | Feeds total, daily, and per-meal financial caps into a multi-objective Knapsack solver; balances paid activities with free local gems; receipt-OCR group expense ledger. | Keeps spending strictly bounded; eliminates awkward group math and split calculations. |
| | **3. Context-aware packing checklist** | Evaluates hourly weather forecasts (rain gear, UV) and cultural/religious dress codes (modest attire for mosques and temples); generates bilingual emergency allergy cards and shared-item claims. | Prevents missing critical gear or medication; avoids on-site entry refusal for dress code. |
| **Pre-trip co-creation** | **4. Smart timeline jigsaw & group bargaining scheduler** | AI generates the initial DAG draft; blocks drag with magnetic snapping on a 30-minute grid; embeds minimax-regret minimisation and Pareto frontier filling, with a shorten/replace/split trilemma on collision. | Converts a chaotic group chat into a visual puzzle; the algorithm plays the impartial judge, so nobody has to be the one who concedes. |
| **Planning & discovery** | **5. Serendipity & exploration engine (anti-filter-bubble)** | Implements an ε-greedy exploration mechanism; surfaces out-of-comfort-zone suggestions (local subcultures, artisan workshops, seasonal micro-events); generates "Safe vs. Wildcard" itinerary variants. | Prevents repetitive recommendations; balances comfort with spontaneous authentic discovery. |
| | **6. Group split & merge routing** | Clusters travelers by interest vector and spending capacity (Photography Crew vs. Deep Heritage Crew); routes sub-branches via time-window graph optimization; converges punctually at a consensus anchor. | Ends mutual compromise; individuals pursue what they value while the group trip stays intact. |
| | **7. Multi-modal mobility decisions** | Computes group rideshare break-even economics (3–4 passenger ride-hail vs. transit fares); outputs Fastest, Budget, and Scenic Walk options; pivots to covered/indoor connections under rain triggers. | Removes transit trade-off friction; delivers optimal cost-to-time trade-offs dynamically. |
| **On-site execution** | **8. 3D landmark navigation** | Renders extruded 3D geometry at a 60° camera pitch; highlights turn-by-turn landmarks; serves conversational orientation cues ("walk toward the clock tower, turn right at the McDonald's"). | Eliminates spatial confusion, compass-heading errors, and 2D GPS drift at intersections. |
| | **9. Photo spot & lighting engine** | Pinpoints exact ground coordinates ("Golden Footprints"); uses SunCalc to compute sun azimuth and elevation to schedule spots during Golden and Blue Hours; provides focal length and framing guides. | Eliminates bad lighting, crowded framing, and tourist-trap vantage points. |
| | **10. Environmental self-healing** | Triggers sub-second DAG retopology when precipitation exceeds 70%, budgets run over, or ad-hoc detours occur — swapping outdoor routes for indoor equivalents and rebalancing financial headroom. | Keeps itineraries resilient against weather disruption and sudden change. |
| | **11. Multimodal on-site VQA** | Ingests snapshots of local food to screen for allergen cross-contamination and detail culinary origins; analyzes heritage architecture to identify styles and historical context. | Protects dietary safety on the spot while delivering rich cultural storytelling. |

## II-b. Progressive conflict resolution framework

The system removes the guilt of avoiding conflict by escalating through four levels rather than
falling back on majority rule. Each level is only reached when the one above it cannot hold.

```text
Level 0: Pre-trip timeline jigsaw co-creation --> turn compromise into a drag game
   |  (intention divergence appears in group chat)
Level 1: Pareto optimal substitution ----------> everyone still travels together
   |  (preferences or energy levels diverge)
Level 2: Co-located micro-zone split ----------> same 300 m area, tailored experiences
   |  (itineraries are entirely mutually exclusive)
Level 3: Strategic split & merge --------------> split with tasks, merge at a ritual anchor
```

### The four-step bargaining pipeline (Level 0)

When three or more members drag their preferred blocks, the system runs this pipeline instead of a
crude vote. It is implemented in `lib/domain/jigsaw.ts` and re-runs on every drag.

| Step | Algorithmic logic | UI feedback |
| --- | --- | --- |
| **1. Rigid anchor locking** | Blocks at weight >= 9 with a fixed time freeze as immovable red anchors. Everything else may only fill the idle windows between them. | Red lock icons with a magnetic force field; other blocks avoid them automatically. |
| **2. Pareto frontier filling** | Multi-objective knapsack over the idle windows. Maximise total team satisfaction under a hard floor: no member drops below 70% of their own best case, so nobody is merely accompanying the group. | Generates high-consensus drafts for one-click team voting. |
| **3. Round-robin veto** | A wish wheel. In contribution order, each member forcibly places one block per turn. What never fits collects in the unaccommodated wish pool. | Side panel of unplaced gems, offered as Level 2 micro-zone split targets. |
| **4. Explicit split cut** | If satisfaction spread exceeds the threshold, or the fairness floor cannot be met, the day splits into two trajectories that reconverge at the dinner anchor within 10 minutes. | A scissors line on the timeline; the map draws bifurcated routes and the chat opens a pre-poll. |

**Minimax regret is the objective.** Each member's regret is their own best achievable score at the
same schedule size minus what the current schedule gives them. The pipeline minimises the maximum
regret across members, which is what makes the outcome comparable between people with very
different tastes rather than just summing scores and letting a majority win.

## III. Deep-dive: Module 5 — serendipity & dynamic exploration engine

Recommendation engines frequently fall into the **algorithmic echo chamber**: if a user tags "coffee and modern art," they get trapped in identical cafes and galleries. WanderSync treats exploration as a core algorithmic primitive.

1. **The ε-greedy travel recommender**
   - **Exploitation (1 − ε, ~80%):** aligns tightly with confirmed group preferences, dietary rules, and budget limits.
   - **Exploration (ε, ~20%):** injects high-variance, off-the-beaten-path POIs — traditional batik workshops, hidden residential food courts, obscure architectural anomalies — that contrast with the dominant profile **without violating any dietary or mobility constraint**. Exploration items pass the same [hard-constraint gate](#vii-hard-constraint-gate) as exploitation items. Serendipity is a relaxation of *taste*, never of *safety*.

2. **"Switch It Up" alternate modes** — one click in the workspace requests instant alternatives:
   - **Safe Track:** the crowd-pleasing, highly verified route.
   - **Local Track:** where residents actually go; avoids international tourist density.
   - **Wildcard Track:** an entirely different theme (retail mall → urban greenway plus antique night market).

3. **Contextual in-situ suggestions ("spontaneous detours")** — while the group walks a planned path, the system watches hyper-local opportunities: *"You have a 30-minute buffer before your dinner reservation. An 80-year-old traditional tea shop is 120 m down this alley — detour?"* One tap to accept or dismiss; accepting recalculates the remaining waypoints through the Phase 4 solver and re-verifies the anchor arrival.

## IV. End-to-end system architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                      Client interaction layer                          │
│   Collaborative workspace  (Next.js route, React 19)                   │
│   - Top 60%: Mapbox 3D spatial map, 60 deg tilt, split/merge routes     │
│   - Bottom 40%: realtime chatroom, AI assistant, action sheet           │
│   - Pre-trip mode: full-screen timeline jigsaw (drag bargaining)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS + Supabase Realtime (WSS)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Next.js application  (gateway + orchestrator)             │
│   - Supabase SSR auth, RLS-scoped data access                          │
│   - Session state machine & multi-source context ingestion             │
│   - LLM intent extraction, VQA, narration  (Gemini, server-only)       │
│   - Hard-constraint gate  (deterministic, Section VII)                 │
│   - Job queue + callbacks  (Redis)                                     │
└───────┬───────────────────────────────────────────────┬────────────────┘
        │ anonymized solve payload / solution           │ reads + writes
        ▼                                               ▼
┌───────────────────────────────────┐   ┌───────────────────────────────────┐
│  Python optimization service      │   │  Supabase                         │
│  (FastAPI, stateless, no creds)   │   │  Postgres + PostGIS + pgvector    │
│  - m-VRPTW solver (OR-Tools)      │   │  Auth, RLS                        │
│  - Multi-objective Knapsack       │   ├───────────────────────────────────┤
│  - Clustering (K-Means / GMM)     │   │  Redis                            │
│  - SunCalc astronomical engine    │   │  ephemeral group location,        │
│  - DAG itinerary retopology       │   │  session state, locks, job queue  │
└───────────────────────────────────┘   └───────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  External providers, called ONLY by Next.js:                           │
│  Mapbox · Google Routes & Transit · OpenWeatherMap · social fetchers    │
└────────────────────────────────────────────────────────────────────────┘

Control boundary:
Gemini drafts and enriches. The Python service computes feasibility and optima.
Next.js validation + Supabase policies decide what is saved, shown, and active.
Humans confirm every state change.
```

## V. Service boundary (Next.js ↔ Python optimization service)

**Next.js owns**

- All authentication, session handling, and RLS-scoped reads/writes. Supabase credentials live only here.
- The collaborative workspace: realtime chat, presence, the embedded assistant, and the flashcard timeline, all served as Next.js routes.
- All Gemini calls: intent extraction, "Switch It Up" narration, orientation cues, VQA, detour copy.
- The **hard-constraint gate**: no itinerary item is persisted or shown as approved until it passes.
- Orchestration: builds solve payloads, enqueues jobs, applies solutions, pushes confirmations.
- All external-provider calls (Mapbox, Google Routes/Transit, OpenWeatherMap, social fetchers).

**Python optimization service owns**

| Endpoint | Responsibility |
| --- | --- |
| `POST /solve/schedule` | Multi-objective Knapsack over candidate activities with total / daily / per-meal caps; returns selected set + slack per cap. |
| `POST /solve/cluster` | K-Means / GMM over interest vectors + budget capacity; returns branch assignments. |
| `POST /solve/route` | m-VRPTW with time windows, sub-branches, and a consensus anchor; returns ordered waypoints + arrival times per branch. |
| `POST /solve/sun` | SunCalc azimuth/elevation for coordinates + date; returns golden- and blue-hour windows. |
| `POST /solve/reoptimize` | Partial DAG retopology given a trigger and a locked set; returns a minimal diff. |
| `GET /healthz` | Liveness. |

**Contract rules**

- The service is **stateless and pure**: no database, no Redis, no outbound HTTP, no clock-dependent behavior except values passed in the payload. A CI check enforces the absent dependencies.
- Auth is a single shared secret (`OPT_SERVICE_TOKEN`) in an `Authorization` header, plus network isolation in production.
- Payloads are **anonymized**: travelers are opaque handles (`t1`…`tn`); dietary constraints arrive as enum flags (`halal`, `no_peanut`, …), never free text or names; POIs are ids + coordinates + cost tier + tags.
- Every request and response is Zod-validated on the Next.js side and Pydantic-validated on the Python side against a shared `schema_version`. Version mismatch is a hard error, never a silent coercion.
- Solvers are deterministic under a supplied seed, so a solution can be reproduced in a test from the persisted payload.
- Solver failure, timeout, or infeasibility returns a typed error; Next.js leaves the current active itinerary unchanged and surfaces a clear message.

## VI. Persistence model

New tables extend the existing `trips` / `trip_members` / itinerary schema. All are trip-scoped with RLS mirroring the current policies (`can_view_trip`, `can_manage_trip`, owner-only activation). Requires the `postgis` and `vector` extensions.

- `traveler_profiles` — per member: `interest_vector vector(64)` (pgvector), `budget_daily_cap numeric`, `budget_total_cap numeric`, `pace`, `mobility_threshold_m int`. **No free-text medical data.**
- `trip_constraints` — hard constraints as typed rows: `kind` (`dietary` | `religious_access` | `mobility`), `flag` (enum), `severity` (`severe` | `standard`), `source` (`chat` | `voice` | `social` | `manual`), `confirmed_by`, `confirmed_at`. Nothing is enforced until `confirmed_at` is set.
- `poi_catalog` — cached POIs: `geog geography(Point,4326)` (PostGIS), `cost_tier`, `tags text[]`, `halal_status` (`verified` | `claimed` | `unknown` | `no`), `allergen_risk text[]`, `indoor bool`, `dress_code` enum, `tourist_density` enum.
- `itinerary_dag` — nodes (activities, transits) + edges with time windows; `locked bool` for visited or fixed-reservation nodes; supports partial re-optimization.
- `subgroups`, `subgroup_members`, `split_sessions` — branch assignments, rendezvous point (`geog`), convergence time.
- `mobility_options` — computed Fastest / Budget / Scenic legs with cost, duration, and `weather_sensitive bool`.
- `expenses`, `expense_shares` — receipt-OCR ledger; deterministic split; append-only with reversing entries.
- `packing_items` — checklist rows with `reason` (`weather` | `dress_code` | `medical` | `shared`) and `claimed_by`.
- `chat_messages` — append-only trip chat: `author_member_id`, `author_kind` (`member` | `assistant` | `system`), `body`, optional `proposal_id` referencing `agent_proposals`, `status`. Broadcast over `trip:{trip_id}`, but visibility enforced by RLS, never by the channel name.
- `serendipity_log` — surfaced exploration POIs plus accept/dismiss outcome, feeding the diversity and dedupe guardrail.
- `heal_events` — trigger, diff applied, confirmation state.
- Redis keys (ephemeral, TTL'd): `trip:{id}:loc:{member}` live location, `trip:{id}:session` state-machine cursor, `trip:{id}:lock` re-optimization mutex.
- Supabase Realtime presence (ephemeral, never persisted): who is viewing the trip, and typing indicators.

## VII. Hard-constraint gate

A single deterministic function every candidate item — from Gemini, from a solver, from a detour — must pass before it is stored or displayed as approved. It is **never** delegated to an LLM.

| Constraint | Rule |
| --- | --- |
| **Dietary** | If an allergen flag is a confirmed trip constraint, any food POI listing that allergen in `allergen_risk` is rejected. `unknown` allergen data on a food POI is **fail** for `severe` flags, **warn** otherwise. |
| **Halal** | If `halal` is confirmed, food POIs must have `halal_status = verified`. `claimed` is warn-with-confirmation; `unknown` and `no` fail. |
| **Religious access / dress code** | A POI with a `dress_code` requirement generates a mandatory packing item and a pre-visit reminder. It is never silently scheduled. |
| **Budget** | The selected set's cost must not exceed total / daily / per-meal caps for **any** affected traveler, including per-branch caps after a split. Cost tiers are estimates; the gate uses the conservative upper bound of the tier. |
| **Mobility** | Legs exceeding a member's `mobility_threshold_m` are rejected or flagged by severity. |
| **Time** | No overlap, no midnight crossing, and arrival at the consensus anchor no later than the convergence time. |

Gate output is `pass` | `warn` (needs explicit human confirmation) | `fail` (never shown as approved). Every `warn` and `fail` is logged with a machine-readable reason for audit.

## VIII. Complete execution lifecycle

```text
[Group-chat setup]
Amira (Halal, budget-flexible) · Ben (peanut allergy, RM150/day) ·
Chloe (photography) · Danish (heritage, student RM150/day)
       │
       ▼
[Constraint & budget ingestion]  — Modules 1, 2
- LLM extracts hard constraints from chat + voice: halal=true, no_peanut=true (severe).
- Each is shown back for one-tap confirmation before it is enforced.
- Knapsack ceiling set: average spend per person ≤ RM150/day; per-meal cap derived.
- Packing list: mosque modesty alert + offline bilingual peanut-allergy card.
       │
       ▼
[Itinerary formulation + serendipity dial]  — Module 4
- Safe vs. Wildcard offered; the group picks a 20% serendipity blend.
- Schedule solver returns landmarks plus one hidden artisan alley; the gate clears every item.
       │
       ▼
[Mid-day split & merge]  — Modules 5, 8
- 14:00–17:30 split window:
  · Branch 1 (Amira + Chloe): 3D-guided to a high viewpoint; SunCalc targets 17:10 golden hour.
  · Branch 2 (Ben + Danish): colonial heritage district; student concession pricing applied.
- 18:00 anchor: both branches converge at a verified-Halal, nut-free restaurant (RM35 pp).
       │
       ▼
[Dynamic in-trip self-healing]  — Modules 9, 6
- 16:15: weather radar shows 85% thunderstorm probability.
- Partial DAG retopology: outdoor photo leg → sheltered historic arcade 200 m away.
- Rideshare evaluator: one 4-seat ride-hail at RM14 total beats four transit fares, and stays dry.
- Healed plan is pushed to the group; the original stays active until confirmed.
       │
       ▼
[On-site multimodal interaction]  — Modules 10, 2
- Dinner: Ben photographs an unfamiliar dessert. VQA flags crushed-peanut garnish → urgent alert.
- Bill: Amira uploads the receipt. OCR + deterministic split update the ledger, zero manual math.
```

## Architectural moats

1. **Closed-loop adaptation over static agendas.** Traditional apps produce read-only itineraries. This system runs a continuous feedback loop that actively recovers from weather spikes, budget overruns, and impromptu detours.
2. **Mathematical coordination over majority compromise.** Modeling group dynamics as clustered multi-vehicle routing with time windows preserves individual agency without fragmenting the shared journey.
3. **Intuitive spatial immersion over abstract 2D lines.** 3D extruded urban canvases, salient visual landmarks, and exact ground-level camera placements replace confusing map dots with human-scale navigation.
4. **Controlled serendipity over algorithmic echo chambers.** The dual exploration–exploitation model hits the must-see items while continuously surfacing unscripted, authentic experiences — always inside the safety gate.

---

## Delivered foundation (do not rebuild)

Phase 0/1 of the earlier plan is implemented on `main` and is the baseline WanderSync builds on. Extend it; do not re-implement it.

- Magic-link Supabase auth, SSR sessions, protected routes, `middleware.ts`.
- Authenticated trip repository (`lib/repositories/supabase-trip-repository.ts`) with RLS-enforced isolation, revision checks, and per-user/per-trip rate limits.
- Gemini structured-proposal contract (`lib/gemini/*`), Zod schemas, deterministic schedule validation, pending-proposal persistence, owner-only confirm/reject with atomic activation.
- Proposal-review UI (`components/gemini-proposal-review.tsx`).
- Local test suite: Vitest + PGlite (real SQL and RLS execution), Playwright component tests. See `docs/testing/phase-0-1.md`.
- Retirement migration `202609050001_retire_telegram_surface.sql` drops `trip_members.telegram_user_id` and narrows the retired `constraints.source` domain.

**Open baseline items, carried forward (close before Phase 1 exit):**

- [ ] Hosted end-to-end verification of create → generate → confirm → reload against a disposable Supabase project (`docs/testing/phase-0-1.md`, Live Service Gate).
- [ ] Full multi-role HTTP RLS matrix from `tests/database/live-rls.md`.
- [ ] Abandon `origin/codex/phase-0-1`. Its only unmerged content is the retired Telegram link-token/webhook work; delete the branch rather than merging it. Its mock-account e2e harness may be cherry-picked if still useful.
- [ ] Add GitHub Actions CI (`.github/workflows/ci.yml`) running the full [verification standard](#verification-standard) for both the Node app and the Python service.
- [ ] Remove the stray untracked `web/` scaffold. Keep or drop the uncommitted `@supabase/phoenix` dependency deliberately — `@supabase/realtime-js` already ships transitively with `@supabase/supabase-js`, so a direct dependency is only warranted if Task 3.1 needs to pin it.

**Scope changes vs. the earlier plan:** the retired "scope lock" and the non-goals covering per-member profiles, allergen and dietary data, weather/Plan-B logic, and split/merge are **lifted**. Handling requirements for that data now live in [Section IX](#ix-data-privacy--safety-appendix). The MBTI quiz, the provider-status dashboard, and autonomous booking/payments remain out of scope — see [Explicit non-goals](#explicit-non-goals).

---

## Phase 1 — Intent & hard-constraint extraction (Module 1)

**Priority: highest.** Every downstream optimization depends on a correct, confirmed constraint set, and the dietary and religious constraints are safety-critical. Nothing else should start before the gate exists.

### Task 1.1: Constraint & profile schema

**Files:** create `supabase/migrations/2026090X0001_traveler_profiles_constraints.sql`, `lib/domain/constraints.ts`, `tests/domain/constraints.test.ts`, `tests/database/constraints-rls.test.ts`. Enable the `postgis` and `vector` extensions.

- [ ] Add `traveler_profiles`, `trip_constraints`, and `poi_catalog` with trip-scoped RLS matching the existing policies.
- [ ] `trip_constraints` rows are inert until `confirmed_at` is set; enforcement reads go through a view that filters `confirmed_at is not null`.
- [ ] Typed enums for `dietary` / `religious_access` / `mobility` flags and for `severity`; reject free text in flag columns at the database level.
- [ ] Contract and PGlite RLS tests: owner/planner write, member read, unrelated denial, unconfirmed rows excluded from the enforcement view.
- [ ] Run lint, test, build.

### Task 1.2: Multi-source context ingestion

**Files:** create `lib/ingestion/{chat,voice,social}.ts`, `lib/ingestion/extract.ts`, `app/api/trips/[tripId]/ingest/route.ts`, `tests/ingestion/*.test.ts`.

- [ ] Chat: read the trip's own `chat_messages` history, and accept pasted text from an outside group chat.
- [ ] Voice: accept audio, transcribe via Gemini, feed the text to the extractor.
- [ ] Social: fetch Instagram / TikTok / Xiaohongshu URLs through a pluggable fetcher interface with per-host adapters. **Caption and oEmbed text only**; respect robots and rate limits; no login-walled scraping. Store only derived interest tags, never raw third-party content.
- [ ] `extract.ts`: one Gemini call → structured JSON (`interestTags[]`, `candidateConstraints[]` with `kind` / `flag` / `severity` / `evidence`) → Zod. A deterministic post-filter maps evidence phrases to enum flags; anything unmapped becomes a manual review item and is never auto-enforced.
- [ ] Fake-client tests: valid extraction, malformed JSON, ambiguous evidence, and prompt injection inside ingested text (must not create a constraint or exfiltrate trip data).
- [ ] Rate-limit ingestion per user and per trip.

### Task 1.3: Confirmation & interest-vector build

**Files:** create `components/constraint-review.tsx`, `lib/domain/interest-vector.ts`, `app/actions/constraints.ts`, `tests/components/constraint-review.test.tsx`, `tests/domain/interest-vector.test.ts`.

- [ ] UI lists each candidate constraint with its evidence and a one-tap Confirm / Edit / Reject. Nothing is enforced until an authorized member confirms.
- [ ] `severe` flags require confirmation from the affected member, or from the owner acting on their behalf with the actor logged.
- [ ] Deterministic embedding of confirmed interest tags into `interest_vector` via a fixed tag→dimension map. No LLM in the write path.
- [ ] Tests: confirm enforces, reject discards, edit re-maps, unauthorized actor denied, severe flag cannot be confirmed by an unrelated member.

### Task 1.4: Hard-constraint gate

**Files:** create `lib/domain/constraint-gate.ts`, `tests/domain/constraint-gate.test.ts`. Modify `lib/domain/gemini-proposal-validation.ts`.

- [ ] Implement the gate exactly as [Section VII](#vii-hard-constraint-gate): `pass` | `warn` | `fail` with a machine-readable reason.
- [ ] `unknown` allergen or halal data fails closed for `severe` flags and warns otherwise.
- [ ] Pure function over `(item, confirmedConstraints, travelerCaps)`; no I/O, no clock reads.
- [ ] Exhaustive table tests for dietary, halal, dress code, budget upper bound, mobility, and time.
- [ ] Wire the gate into the existing proposal-validation path so today's Gemini proposals also pass through it.

**Phase 1 exit criteria:** ingested chat, voice, and social input produce candidate constraints; only human-confirmed constraints are enforced; the gate rejects a peanut-risk food POI and an unverified-halal POI in an automated test; the open baseline items above are closed.

---

## Phase 2 — Optimization service boundary & budget scheduling (Module 2)

**Priority: high.** Introduces the Python service and the first real optimization. Every later phase reuses this boundary, so the contract must be right here.

### Task 2.1: Stand up the Python optimization service

**Files:** create `services/optimizer/` (`pyproject.toml`, `app/main.py`, `app/schemas.py`, `app/solvers/`, `tests/`), `services/optimizer/Dockerfile`, `services/optimizer/README.md`. Modify `.env.example`; create `docker-compose.yml`.

- [ ] FastAPI app with `GET /healthz` and shared-secret auth middleware (`OPT_SERVICE_TOKEN`); reject a missing or wrong token with 401.
- [ ] Pydantic request/response models carrying `schema_version`; respond 409 on mismatch.
- [ ] Enforce statelessness: no database driver, no Redis client, and no outbound HTTP in the dependency graph. Add a CI check that fails if one appears.
- [ ] `pytest`, `ruff`, and `mypy` green with a coverage gate.
- [ ] `docker-compose` brings up Next.js, the optimizer, and Redis together for local development.

### Task 2.2: Next.js → optimizer client

**Files:** create `lib/optimizer/client.ts`, `lib/optimizer/payloads.ts`, `lib/optimizer/errors.ts`, `tests/optimizer/client.test.ts`.

- [ ] Typed client with Zod validation in both directions and a hard timeout.
- [ ] `payloads.ts` builds **anonymized** payloads (opaque traveler handles, enum flags, POI ids only). Unit-test that a payload contains no names, emails, or free text.
- [ ] Map solver failure, timeout, and infeasibility to a stable `OptimizerError`; callers leave active state untouched.
- [ ] Fake-server tests for success, 5xx, timeout, infeasible, and schema mismatch.

### Task 2.3: Multi-objective Knapsack scheduler

**Files:** create `services/optimizer/app/solvers/schedule.py`, `services/optimizer/tests/test_schedule.py`, `app/api/trips/[tripId]/schedule/route.ts`, `tests/api/schedule.test.ts`.

- [ ] OR-Tools model maximizing aggregated interest-match utility subject to total, daily, and per-meal cost caps, with a paid/free balance term so free local gems are not crowded out.
- [ ] Return the selected activity set plus remaining slack per cap; deterministic under a supplied seed.
- [ ] Python tests: caps respected, infeasible when caps are too tight, free-gem substitution when a paid option is dropped, stable output under a fixed seed.
- [ ] Next.js route: authorized actor → build payload → solve → run every returned item through the [gate](#vii-hard-constraint-gate) → persist as a **pending** proposal. Never auto-activate.

### Task 2.4: Receipt-OCR expense ledger

**Files:** create `supabase/migrations/2026090X0002_expense_ledger.sql`, `lib/domain/ledger.ts`, `lib/ocr/receipt.ts`, `app/api/trips/[tripId]/expenses/route.ts`, `tests/domain/ledger.test.ts`, `tests/ocr/receipt.test.ts`.

- [ ] `expenses` and `expense_shares` with RLS; append-only with reversing entries rather than destructive edits.
- [ ] Gemini VQA extracts line items and total from a receipt image → Zod; the uploader confirms before it posts.
- [ ] Deterministic split math in `ledger.ts` (equal, weighted, subgroup-only). **No LLM in the arithmetic path**; rounding reconciled to the cent.
- [ ] Tests: equal-split rounding, subgroup-only cost, duplicate submission idempotency, unauthorized creation denied, balance correct after a reversal.

**Phase 2 exit criteria:** the optimizer runs under `docker-compose`; a budget-bounded schedule solve returns a gate-clean pending proposal for the reference trip; a receipt produces a correct ledger split with no manual arithmetic.

---

## Phase 3 — Collaborative workspace: realtime chat & flashcard timeline (client layer)

**Priority: high.** This is the product's only interface. Every later module surfaces through it, so
the realtime, authorization, and confirmation primitives established here are reused everywhere.

The workspace lives at `/trips/[tripId]/workspace` as a dual-layer contextual surface: the **top
60%** is the Mapbox 3D spatial map, the **bottom 40%** is the realtime chatroom and action sheet.
Pre-trip mode replaces the whole surface with the full-screen **timeline jigsaw**, because drag
bargaining needs the horizontal room. See `docs/features/collaborative-workspace.md`.

### Task 3.0: Level 0 bargaining engine and jigsaw panel — DELIVERED

**Files:** `lib/domain/jigsaw.ts`, `lib/domain/debt-simplify.ts`, `features/timeline/jigsaw-panel.tsx`,
`features/workspace/workspace-shell.tsx`, `app/globals.css`, `tests/domain/jigsaw.test.ts`,
`tests/domain/debt-simplify.test.ts`, `tests/components/jigsaw-panel.test.tsx`.

- [x] Pure four-step pipeline: `partitionAnchors`, `paretoFill`, `roundRobinVeto`, `shouldSplitCut`.
- [x] Minimax regret via `evaluateTeam`, measuring each member against their own best case.
- [x] 30-minute grid with `snapToGrid`, elastic anchor magnetism via `magneticSnap`, and
      `detectConflicts` / `trilemmaOptions` for the shorten/replace/split banner.
- [x] Block geometry and texture (`blockWidthSlots`, `blockTexture`): width proportional to
      duration, solid green consensus, orange-striped AI fill, blue-dotted personal wish.
- [x] Exact-integer debt graph simplification (`simplifyDebts`) so a settled trip needs at most
      n-1 transfers. No floating point, no LLM, in the money path.
- [x] `JigsawPanel` with pointer drag, keyboard drag, per-member satisfaction meters, conflict
      banner, split suggestion, and the unaccommodated wish pool.
- [x] `WorkspaceShell` 60/40 surface with the full-screen jigsaw toggle.
- [x] 53 tests across the engine and the panel.
- [ ] Persist drags through a revision-checked server write (folds into Task 3.4).
- [ ] Multiplayer presence cursors during a drag (folds into Task 3.2).

### Task 3.1: Chat persistence & Realtime transport

**Files:** create `supabase/migrations/2026090X0005_chat_messages.sql`, `lib/chat/repository.ts`,
`lib/realtime/channel.ts`, `tests/chat/repository.test.ts`, `tests/database/chat-rls.test.ts`.

- [ ] `chat_messages` per `docs/database-structure.md`: append-only, `author_kind` in
      (`member`, `assistant`, `system`), optional `proposal_id`, trip-scoped RLS.
- [ ] Subscribe to `trip:{tripId}` via `supabase.channel(...)`. **Visibility is enforced by RLS, not
      by the channel name** — add a test proving a non-member subscribing to another trip's channel
      receives no rows.
- [ ] Reconnect and backfill: on resubscribe, fetch messages newer than the last seen id so a dropped
      socket cannot silently lose messages. Fall back to polling when the socket will not connect.
- [ ] Tests: append-only enforcement, non-member denied read and write, backfill after gap, ordering
      stable under concurrent inserts.

### Task 3.2: Chat UI with presence and avatars

**Files:** create `features/chat/` (`chat-pane.tsx`, `message-list.tsx`, `message-item.tsx`,
`composer.tsx`, `presence-bar.tsx`, `use-trip-channel.ts`), `tests/components/chat/*.test.tsx`.

- [ ] Render each message with the author's avatar, display name, and timestamp; group consecutive
      messages from one author. Assistant and system turns are visually distinct from member turns.
- [ ] Presence bar shows who is currently viewing the trip, from the channel presence payload.
      Typing indicators are ephemeral presence state and are never persisted.
- [ ] Optimistic send with a pending state; a failed write surfaces a retry rather than dropping text.
- [ ] Accessible: keyboard-navigable, live region for incoming messages, focus retained on send.
- [ ] Style with the existing `app/globals.css` tokens and `lucide-react` icons. No emoji as
      interface chrome, per the standing frontend rule.
- [ ] Tests: renders authors and avatars, presence join/leave, optimistic send and failure retry,
      assistant turn styling, no cross-trip message leakage in props.

### Task 3.3: Embedded AI assistant

**Files:** create `lib/chat/assistant.ts`, `app/api/trips/[tripId]/chat/assistant/route.ts`,
`features/chat/assistant-proposal-card.tsx`, `tests/chat/assistant.test.ts`.

- [ ] The assistant answers only when addressed — an `@ai` mention or the assistant composer — never
      on every message.
- [ ] Context is the trip record plus a **bounded** recent-message window. Never send another trip's
      history. Reuse the existing `lib/gemini` client and Zod validation rather than a new path.
- [ ] The assistant **cannot mutate state**. When it suggests an itinerary change it writes an
      `agent_proposals` row and posts a message referencing it via `proposal_id`; the message renders
      as an inline proposal card that an authorized member accepts or dismisses.
- [ ] Chat text is untrusted input: test that an injected instruction in a member message cannot make
      the assistant activate a plan, leak another trip, or bypass the constraint gate.
- [ ] Rate-limit assistant invocations per user and per trip.
- [ ] Tests: responds only when addressed, proposal card round-trip, accept requires authorization,
      provider failure leaves the active itinerary unchanged.

### Task 3.4: Persist and synchronise jigsaw drags

**Files:** create `features/timeline/` (`timeline-pane.tsx`, `day-column.tsx`, `activity-card.tsx`,
`use-drag-commit.ts`), `app/api/trips/[tripId]/itinerary/reorder/route.ts`,
`tests/components/timeline/*.test.tsx`, `tests/api/itinerary-reorder.test.ts`.

- [ ] Extend the delivered `JigsawPanel` to multi-day: flashcards grouped by day, dragging across
      days as well as within one.
- [ ] Drop applies an optimistic local update, then a server-validated write. **Every reorder is
      revalidated** by the existing deterministic schedule rules and the Phase 1 constraint gate
      before persistence; a refusal rolls the card back and shows the reason on the card.
- [ ] Card states are visually distinct: active, pending proposal, AI-suggested, conflicted.
- [ ] Writes carry the trip revision. A stale revision loses and the client refetches, so two members
      dragging at once cannot silently clobber each other.
- [ ] Remote reorders from other members animate into place over the same `trip:{tripId}` channel,
      with multiplayer presence cursors so asynchronous negotiation is visible. Target: all
      members see a resolved conflict within 500 ms.
- [ ] Tests: reorder within a day, move across days, rejected drop rolls back with a reason,
      stale-revision write is refused, overlap and midnight-crossing refused, keyboard drag works.

### Task 3.5: Workspace shell & confirmation primitive

**Files:** create `app/trips/[tripId]/workspace/page.tsx`, `features/workspace/workspace-shell.tsx`,
`lib/domain/confirm.ts`, `tests/components/workspace-shell.test.tsx`, `tests/domain/confirm.test.ts`.

- [ ] Dual-pane layout with a responsive tab collapse below the tablet breakpoint.
- [ ] One reusable confirmation primitive: propose → render a confirm affordance → single-use token →
      authorized-actor check → apply → acknowledge. Every later mutating flow (split/merge, expense,
      detour, self-heal, track switch) uses this instead of rolling its own.
- [ ] Tests: replay, expiry, wrong actor, double-accept, and responsive collapse.

**Phase 3 exit criteria:** two signed-in members of the same trip see each other's messages and
presence live; the assistant answers an `@ai` question and posts a proposal card that only an
authorized member can accept; dragging a card between days persists for both members and is refused
with a visible reason when it breaks a schedule or constraint rule.

---

## Phase 4 — Group routing, split & merge, mobility (Modules 5 & 6)

### Task 4.1: Traveler clustering

**Files:** create `services/optimizer/app/solvers/cluster.py`, `services/optimizer/tests/test_cluster.py`, `app/api/trips/[tripId]/subgroups/suggest/route.ts`, `tests/api/subgroups.test.ts`.

- [ ] K-Means / GMM over `interest_vector` plus normalized budget capacity; configurable branch count (2–3).
- [ ] Deterministic under a seed. Return the assignment plus per-branch feature weights; the human-readable rationale is generated in Next.js, not the solver.
- [ ] Tests: separable interests cluster cleanly, an all-similar group falls back to a single branch, a budget outlier is not isolated alone unless interests also diverge.

### Task 4.2: m-VRPTW routing with a consensus anchor

**Files:** create `services/optimizer/app/solvers/route.py`, `services/optimizer/tests/test_route.py`, `app/api/trips/[tripId]/route-plan/route.ts`, `tests/api/route-plan.test.ts`.

- [ ] OR-Tools routing: per-branch ordered waypoints, time windows, a travel-time matrix supplied by Next.js from Mapbox/Google Routes, and a shared rendezvous node every branch must reach by the convergence time.
- [ ] Return arrival times and slack; report infeasible if a branch cannot make the anchor.
- [ ] Tests: two branches converge on time, a tightened window becomes infeasible rather than silently late, an added stop reflows downstream arrivals.

### Task 4.3: Split / merge flow

**Files:** create `supabase/migrations/2026090X0003_subgroups.sql`, `lib/domain/subgroups.ts`, `lib/domain/merge-recommendation.ts`, `features/workspace/split-merge-panel.tsx`, `tests/domain/{subgroups,merge-recommendation}.test.ts`, `tests/components/split-merge.test.tsx`.

- [ ] `subgroups`, `subgroup_members`, and `split_sessions` with trip-scoped RLS; rendezvous stored as PostGIS `geog`.
- [ ] The split panel proposes branches from Task 4.1 behind the Task 3.5 confirmation primitive; members may move themselves between branches before confirming. Gemini may suggest branches but must never assign people.
- [ ] Deterministic ETA guidance bands on merge:

```text
0–20 minutes:  wait at the named rendezvous anchor
21–60 minutes: suggest a low-commitment nearby pause
61+ minutes:   continue to the next fixed commitment
```

- [ ] Per-branch budget caps enforced by the [gate](#vii-hard-constraint-gate) after assignment.
- [ ] Tests: the three ETA bands, non-member assignment rejected, unauthorized split rejected, merge completion is confirmation-first.

### Task 4.4: Multi-modal mobility decisions

**Files:** create `lib/mobility/breakeven.ts`, `lib/mobility/options.ts`, `app/api/trips/[tripId]/legs/[legId]/mobility/route.ts`, `tests/mobility/*.test.ts`.

- [ ] Rideshare break-even: compare a 3–4-passenger ride-hail fare estimate against summed transit fares for the branch size. Deterministic given quoted prices.
- [ ] Emit Fastest / Budget / Scenic-Walk options with cost and duration from Google Routes & Transit.
- [ ] A rain trigger (from the Phase 7 monitor or a manual flag) marks weather-sensitive legs and prefers covered or indoor connections.
- [ ] Keep routes text- and map-based; no live vehicle tracking.
- [ ] Tests: break-even flips at the expected party size, the scenic option only appears when it fits the time budget, the rain pivot changes the recommendation.

**Phase 4 exit criteria:** the reference trip produces two interest-clustered branches routed to a shared 18:00 anchor with feasible arrival times; a merge request returns the correct ETA-band guidance; a leg shows all three mobility options with a rideshare break-even.

---

## Phase 5 — Serendipity & exploration engine (Module 5)

### Task 5.1: ε-greedy recommender

**Files:** create `lib/serendipity/recommender.ts`, `lib/serendipity/diversity.ts`, `tests/serendipity/*.test.ts`.

- [ ] Exploitation set: rank POIs by interest-vector similarity and constraint fit. Exploration set: sample high-variance POIs (low similarity, distinct tags, still gate-`pass`) with probability ε, default 0.2 and configurable per trip.
- [ ] Every exploration candidate runs through the [gate](#vii-hard-constraint-gate); a `fail` is dropped and resampled, never surfaced with a warning.
- [ ] Diversity metric plus dedupe against `serendipity_log` history so the same surprise is not re-shown.
- [ ] Deterministic under a seed. Tests cover ε=0 (pure exploitation), ε=1 (all exploration, still constraint-safe), dedupe, and an allergen-risk POI being filtered out of the exploration pool.

### Task 5.2: Safe / Local / Wildcard variants

**Files:** create `lib/serendipity/tracks.ts`, `app/api/trips/[tripId]/tracks/route.ts`, `features/timeline/track-switcher.tsx`, `tests/serendipity/tracks.test.ts`.

- [ ] Generate three itinerary variants from the same constraint set: Safe (high verification and popularity), Local (low `tourist_density`, resident-frequented tags), Wildcard (different theme, maximum diversity within constraints).
- [ ] The workspace switcher swaps the day plan's flashcards with one click; each variant is a **pending** proposal until confirmed.
- [ ] Tests: all three respect caps and dietary flags, Wildcard is measurably more diverse by the Task 5.1 metric, switching never activates a plan.

### Task 5.3: Spontaneous detour engine

**Files:** create `lib/serendipity/detours.ts`, `app/api/trips/[tripId]/detours/scan/route.ts`, `features/chat/detour-card.tsx`, `tests/serendipity/detours.test.ts`.

- [ ] Detect buffer windows on the active DAG: a gap at or above a configurable threshold before the next fixed commitment.
- [ ] Proximity scan of `poi_catalog` (PostGIS radius) for gate-`pass` POIs matching the group vector; rank by interest × proximity × rarity.
- [ ] Offer as an assistant proposal card in chat via the Task 3.5 confirmation primitive, showing the buffer math. Accept calls the Phase 4 solver to reflow remaining waypoints; dismiss logs the outcome and suppresses the POI for the day.
- [ ] Tests: no offer when the buffer is too small, the offer respects the dinner reservation, accepting keeps the anchor arrival feasible.

**Phase 5 exit criteria:** the reference trip's 20% blend yields at least one gate-clean out-of-profile POI; Safe, Local, and Wildcard variants all satisfy Ben's allergy flag and Amira's Halal constraint; a simulated 30-minute buffer produces a detour offer that still makes the 18:00 anchor.

---

## Phase 6 — On-site execution: navigation, photo, packing (Modules 3, 7, 8)

### Task 6.1: 3D landmark navigation

**Files:** create `features/workspace/nav-3d.tsx`, `lib/nav/landmarks.ts`, `lib/nav/orientation-cues.ts`, `tests/nav/*.test.ts`.

- [ ] Mapbox GL 3D building extrusion at a 60° pitch, camera following the active leg, with the next turn landmark highlighted from `poi_catalog` and Mapbox POI data.
- [ ] Conversational cue generation (Gemini) grounded strictly in the supplied map context: "walk toward the clock tower, turn right at the McDonald's." Cues are advisory text; routing stays deterministic.
- [ ] Tests: a cue references only a real feature present in the passed context, no cue is invented when no landmark exists, pitch and marker state render correctly.

### Task 6.2: Photo spot & lighting engine

**Files:** create `services/optimizer/app/solvers/sun.py`, `services/optimizer/tests/test_sun.py`, `lib/photo/spots.ts`, `app/api/trips/[tripId]/photo-spots/route.ts`, `features/workspace/photo-card.tsx`, `tests/photo/*.test.ts`.

- [ ] `/solve/sun`: SunCalc azimuth and elevation for coordinates plus date, returning golden-hour and blue-hour windows.
- [ ] "Golden Footprints": exact stand-here coordinates per spot, with focal-length and framing guide text.
- [ ] The scheduler prefers placing photo spots inside their golden or blue window whenever the DAG has slack.
- [ ] Tests: a known latitude/longitude/date matches reference sun angles, a spot is scheduled into its window when slack exists, guide text is always present.

### Task 6.3: Context-aware packing checklist

**Files:** create `supabase/migrations/2026090X0004_packing_items.sql`, `lib/packing/generate.ts`, `lib/weather/forecast.ts`, `app/api/trips/[tripId]/packing/route.ts`, `features/workspace/packing-list.tsx`, `tests/packing/*.test.ts`.

- [ ] Pull hourly forecast and UV index (OpenWeatherMap) for the trip dates; add rain gear and sun-protection items with a `weather` reason.
- [ ] Add dress-code items with a `dress_code` reason for every planned POI that requires modest attire.
- [ ] Generate a bilingual (English + Malay for the reference region) emergency allergy card from confirmed allergen flags, downloadable and offline-capable.
- [ ] Shared-item claims so one power bank is not packed four times.
- [ ] Tests: forecast rain adds an umbrella, a mosque in the plan adds a dress-code item, the allergy card reflects confirmed flags only, a claim assigns exactly one owner.

**Phase 6 exit criteria:** the workspace shows a 3D navigation view with a grounded orientation cue; a photo spot lists a golden-hour window and a stand-here point; the packing list reflects the real forecast, a dress-code POI, and Ben's allergy card.

---

## Phase 7 — Environmental self-healing (Module 9)

### Task 7.1: Trigger monitors

**Files:** create `lib/heal/monitors.ts`, `app/api/internal/heal/tick/route.ts`, `tests/heal/monitors.test.ts`. Add a Redis-backed schedule (cron route or worker).

- [ ] Monitors: precipitation probability above 70% during an outdoor leg's window, projected budget overrun, and a member-initiated ad-hoc detour.
- [ ] Debounce, and lock per trip (`trip:{id}:lock`) so only one heal runs at a time.
- [ ] Tests: a threshold crossing fires exactly once, a sub-threshold reading does not fire, concurrent ticks serialize.

### Task 7.2: DAG retopology

**Files:** create `services/optimizer/app/solvers/reoptimize.py`, `services/optimizer/tests/test_reoptimize.py`, `lib/heal/retopology.ts`, `tests/heal/retopology.test.ts`.

- [ ] `/solve/reoptimize`: given the DAG, a trigger, and a locked set (visited or fixed-reservation nodes), return a **minimal diff** — swap outdoor nodes for `indoor` equivalents from `poi_catalog`, rebalance budget slack, and reflow only the affected sub-branches.
- [ ] Every swapped-in node passes the [gate](#vii-hard-constraint-gate).
- [ ] Document and measure a latency budget for a single-day DAG; assert it in tests.
- [ ] Tests: rain swaps the photo leg to the arcade while keeping the anchor arrival, a budget-overrun trigger drops the lowest-utility paid item, locked nodes never move.

### Task 7.3: Confirmation-first healed plan

**Files:** create `lib/heal/apply.ts`, `features/workspace/heal-banner.tsx`, `tests/heal/apply.test.ts`.

- [ ] Push the diff to every connected member over the trip channel as a workspace banner plus a chat proposal card, using the Task 3.5 confirmation primitive and showing what changes and why.
- [ ] The current active itinerary stays active until an authorized member confirms. On reject, log and keep the original.
- [ ] `heal_events` records the trigger, the diff, and the outcome.
- [ ] Tests: an unconfirmed heal does not mutate the active plan, confirmation applies atomically, rejection is logged.

**Phase 7 exit criteria:** an 85%-precipitation trigger on the reference trip produces a confirmable diff that swaps the outdoor photo leg for a sheltered arcade, rebalances the budget, keeps the 18:00 anchor, and changes nothing until confirmed.

---

## Phase 8 — Multimodal on-site VQA (Module 10)

### Task 8.1: Food allergen VQA

**Files:** create `lib/vqa/food.ts`, `app/api/trips/[tripId]/vqa/food/route.ts`, `features/workspace/vqa-food.tsx`, `tests/vqa/food.test.ts`.

- [ ] Gemini VQA on a food photo → structured `{ likelyIngredients[], allergenHits[], cuisineOrigin, confidence }` → Zod.
- [ ] Deterministic overlay: any `allergenHits` intersecting a confirmed `severe` flag raises an **urgent** alert regardless of model confidence. Low confidence plus a severe flag also raises urgent "cannot confirm safe."
- [ ] Every response carries a "not a substitute for asking staff" disclaimer.
- [ ] Tests: peanut garnish → urgent alert, clean dish → informational, low-confidence severe case → urgent caution, malformed JSON handled without crashing the flow.

### Task 8.2: Heritage architecture VQA

**Files:** create `lib/vqa/heritage.ts`, `app/api/trips/[tripId]/vqa/heritage/route.ts`, `features/workspace/vqa-heritage.tsx`, `tests/vqa/heritage.test.ts`.

- [ ] VQA → `{ style, era, historicalContext, relatedPOIs[] }`, enriched from `poi_catalog` where a match exists.
- [ ] Tests: a recognizable style returns context, an unrecognizable image returns an honest "not identifiable," and no POI link is fabricated.

### Task 8.3: VQA safety review

**Files:** modify `lib/vqa/*`; create `docs/features/vqa-safety.md`.

- [ ] Audit and test that VQA output can never downgrade or clear a hard constraint. It may only add caution.
- [ ] Rate-limit per user and trip; strip location EXIF from stored images; images are trip-scoped under RLS.
- [ ] Document the failure posture: on any VQA error, default to "ask staff, treat as unsafe" for severe flags.

**Phase 8 exit criteria:** photographing a peanut-garnished dessert on the reference trip raises an urgent allergy alert with the model's reasoning and the staff-check disclaimer; a heritage facade returns style and context with no invented references.

---

## Phase 9 — End-to-end, deployment, demo

### Task 9.1: Full-lifecycle acceptance path

**Files:** create `tests/e2e/wandersync-lifecycle.spec.ts`, `docs/demo-walkthrough.md`.

- [ ] Automate [Section VIII](#viii-complete-execution-lifecycle): ingest constraints → confirm → budget schedule → serendipity blend → split into two branches → self-heal on a weather trigger → merge at the anchor → food VQA alert → receipt ledger split.
- [ ] Mix Playwright with API-level steps. Drive the multi-user path with two concurrent browser contexts so realtime fan-out, presence, and drag-commit conflicts are actually exercised.

### Task 9.2: Deployment readiness

**Files:** create `Dockerfile` (Next.js), `docker-compose.prod.yml`, `.github/workflows/{ci,deploy}.yml`, `docs/deployment.md`. The optimizer `Dockerfile` comes from Task 2.1.

- [ ] Document only server-side secrets: Supabase URL and anon key, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPT_SERVICE_TOKEN`, `MAPBOX_TOKEN`, `GOOGLE_ROUTES_KEY`, `OPENWEATHER_KEY`, `REDIS_URL`. No secret ever gets a `NEXT_PUBLIC_` prefix.
- [ ] The optimizer service is network-isolated and reachable only from the Next.js service.
- [ ] Health endpoints for both services; structured logs with no prompt payloads, no secrets, and no raw personal data.
- [ ] Configure the Supabase Realtime quotas and allowed origins; run a production smoke test with non-sensitive demo data and two concurrent sessions.
- [ ] CI runs the full [verification standard](#verification-standard) for both services on every pull request.

### Task 9.3: Demo

**Files:** `docs/demo-walkthrough.md`.

- [ ] A scripted sub-three-minute run of the reference trip that hits constraint safety, split/merge math, self-healing, and on-site VQA.

**Phase 9 exit criteria:** the team can demonstrate the ingest → optimize → split → heal → merge → VQA → ledger path end to end in under three minutes, with both services deployed and CI green.

---

## IX. Data privacy & safety appendix

This system deliberately handles data the earlier plan avoided: dietary, religious-access, mobility, interest profiles, and live location. These handling requirements are binding.

**Data minimization and scope**

- Collect only what a module needs. Dietary, religious-access, and mobility constraints are stored as **typed enum flags**, never free-text medical histories. No diagnoses, no medication lists, and no disability categories beyond a coarse mobility threshold the traveler sets themselves.
- The Python optimization service receives **anonymized** payloads only: opaque traveler handles and enum flags. It never sees names, contact details, message content, or images.
- Social-media ingestion stores **derived interest tags only**, never raw third-party post content, and only from public or oEmbed surfaces.

**Consent and control**

- A constraint is inert until an authorized member confirms it (Task 1.3). `severe` flags require the affected member's confirmation, or the owner acting on their behalf with the actor recorded.
- Each member can view and delete their own `traveler_profile`, constraints, and interest vector. Deletion removes them from future optimization; `heal_events` and `serendipity_log` retain only anonymized references.
- Live location (`trip:{id}:loc:*`) is Redis-only with a short TTL, never persisted to Postgres, and cleared on trip end or member opt-out. Location is shared only during an active split window.

**Safety posture**

- The [hard-constraint gate](#vii-hard-constraint-gate) is deterministic and the single choke point. No LLM output is trusted to clear a dietary or religious-access constraint.
- Unknown allergen or halal data fails closed for `severe` flags.
- All VQA and LLM dietary output carries a "not a substitute for asking staff" disclaimer and may only add caution, never remove it.
- Emergency allergy cards are bilingual and offline-capable.
- Ingested third-party text (chat, captions, transcripts) is untrusted input. Prompt-injection resistance is a tested requirement in Task 1.2, and extraction output can only ever propose a constraint for human confirmation.

**Retention and logging**

- Structured logs exclude prompt payloads, images, secrets, and raw personal data.
- Images (receipts, VQA) are trip-scoped under RLS, EXIF-stripped, and deleted with the trip.
- A data-subject deletion runbook is documented in `docs/deployment.md`.

## Explicit non-goals

- Autonomous booking, rebooking, payments, or ticketing. The system plans and coordinates; humans transact.
- Real-time emergency dispatch or medical advice. Allergy handling is preventative and informational, not clinical.
- Continuous background location tracking, or location sharing outside an active split window.
- MBTI or personality quizzes, and provider-health/status dashboards. These are retired directions; do not revive them.
- Telegram bots, Telegram Mini Apps, bot webhooks, chat-platform link tokens, or any other third-party chat client. The collaborative workspace is the only interface; this direction is retired and must not be revived.
- Flight status, hotel availability, crowd feeds, or price-drop monitoring.
- Storing sensitive personal data beyond the coarse enum flags defined in Section IX: no medical records, and no religious-profile detail beyond an access and dress-code flag.
- Making the Python service stateful. It gets no database, no Redis, and no external calls; if a solver needs data, Next.js passes it in the payload.
- Emoji as interface decoration, status markers, icons, or visual emphasis. Use text labels, layout, color, and proper icon components.

## Verification standard

Every completed task must provide evidence for each stack it touches.

```text
# Next.js / TypeScript
npm run lint
npm test
npm run test:coverage
npm run build
npx playwright test          # component, workspace, and multi-client e2e where applicable
git diff --check

# Python optimization service (services/optimizer)
ruff check .
mypy .
pytest --cov
```

- Tasks that add Supabase behavior include PGlite SQL/RLS tests plus an entry in `tests/database/live-rls.md` for the hosted matrix.
- Tasks that add solver behavior include deterministic seeded Python tests plus a Next.js fake-server integration test.
- Tasks that add realtime or external-provider behavior include focused tests against a disposable environment or a recorded fake. Realtime tasks must be tested with at least two concurrent clients.
- Tasks that touch the constraint gate must extend `tests/domain/constraint-gate.test.ts`. The gate is never bypassed for expedience.
- No phase is complete until its exit criteria and required tests have evidence in the repository, and CI is green for both services.
