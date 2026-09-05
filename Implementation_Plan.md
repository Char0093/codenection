# WanderSync — Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Keep TDD, review gates, and verification evidence with every task. This document is the binding specification and **replaces the earlier narrowed "travel planner MVP" plan**. Where `docs/` files conflict with this plan, this plan wins; the retired scope-lock and the profile/allergen/weather non-goals in older docs are superseded by [Section IX](#ix-data-privacy--safety-appendix).

For the current delivered/partial/not-started inventory and recommended next task order, read
[`docs/implementation-status.md`](docs/implementation-status.md) before selecting work. The status
file is a point-in-time handoff; this document remains authoritative for requirements.

## What this does

WanderSync is an **end-to-end adaptive collaborative travel system** for group trips. It turns scattered group intent (chat, voice notes, social links) into a validated, budget-bounded, safety-checked itinerary, then keeps that itinerary alive during the trip: it re-optimizes around weather, budget drift, and impromptu detours, coordinates group split-and-merge with real routing math, and gives human-scale on-site help for navigation, photography, and dietary safety.

**Goal:** Deliver a system where an LLM proposes and enriches, deterministic optimization decides what is feasible, and the group explicitly confirms what becomes real — coordinated first in a native, multi-user collaborative workspace in the browser, with a mobile-ready service boundary for a later Android companion.

**Core value:** It systematically resolves the failure modes of existing travel tools — rigid schedules, group compromise fatigue, navigation disorientation, budget drift, and algorithmic echo chambers that over-filter discovery.

**Architecture (hybrid, web-first):** During Phases 0–9, a **Next.js / TypeScript** application owns the complete web experience — the collaborative workspace, Supabase auth and data access, Realtime fan-out, LLM/VQA calls, and orchestration. There is no third-party chat platform, bot, or webview in the product. User-facing operations that a future client needs must also have versioned HTTPS/JSON contracts; do not make a Next.js server action the only way to perform a domain operation. A separate stateless **Python / FastAPI optimization service** owns the operations-research compute: m-VRPTW routing, multi-objective Knapsack scheduling, traveler clustering, astronomical (SunCalc) computation, and DAG itinerary retopology. The Python service holds no credentials beyond a shared secret, never writes the database, and never calls external providers — it receives an anonymized problem payload and returns a solution. After the web lifecycle is validated, Phase 10 may add a native **Kotlin / Jetpack Compose Android companion** against the same server-authoritative contracts.

**Tech stack:** Next.js 15 App Router, React 19, TypeScript, Google Maps JavaScript API with a vector map / 3D Maps (`Map3DElement`), Google Places API (New), Google Routes API (`ComputeRoutes`, `ComputeRouteMatrix`), `lucide-react` icons, pointer-event drag (no drag library: the 30-minute grid and magnetic snapping are custom), and the existing hand-written CSS design tokens in `app/globals.css` (this project does **not** use Tailwind); Supabase Auth / Postgres / PostGIS / pgvector / RLS / **Realtime**; `@google/genai` (Gemini) for intent extraction, VQA, and narration; Zod; Vitest + Playwright. Python 3.12, FastAPI, Google OR-Tools, NumPy / scikit-learn (K-Means, GMM), SunCalc, pytest + ruff + mypy. Redis for ephemeral group location, session state, locks, and a job queue. GitHub Actions CI. Phase 10 default: Kotlin, Jetpack Compose, Google Maps SDK for Android, coroutines/Flow, Room for offline data, Hilt for dependency injection, and Android platform APIs for camera, notifications, and explicitly scoped split-session location.

**Control contract (the moat):** Gemini produces candidates, explanations, and alternatives. It cannot activate a plan, spend money, assign people to subgroups, bypass RLS, or mutate state. The Python service can compute an optimal assignment or route but cannot persist or activate it. Every candidate item passes a deterministic hard-constraint gate ([Section VII](#vii-hard-constraint-gate)) before it is stored or shown as approved, and every state change is confirmed by an authorized human.

## Table of contents

- [What this does](#what-this-does)
- [I. Target users](#i-target-users)
- [II. The eleven core modules](#ii-the-eleven-core-modules)
- [II-a. Hybrid preference model: compact survey and contextual chat learning](#ii-a-hybrid-preference-model-compact-survey-and-contextual-chat-learning)
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
- [Phase 10 — Post-web Android companion](#phase-10--post-web-android-companion)
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

## II-a. Hybrid preference model: compact survey and contextual chat learning

A first-launch survey provides a small, reliable baseline; it is not a personality test and does
not try to predict the whole trip. The full flow is five one-question screens, targeted at under 60
seconds per member. A "Quick mode" captures dealbreakers and budget only, then applies visible,
editable defaults. When a group leader invites members, each invite carries the same prompt, so
onboarding scales with the group rather than being a solo setup step.

Chat then supplies the changing part of preference discovery. Messages, pasted chat, voice
transcripts, and shared public-link captions may produce **expiring discovery signals** such as
`live_jazz`, `indoor_today`, `street_food`, or `quiet_evening`. These signals help find new
attractions, choose Safe / Local / Wildcard variants, suggest spontaneous detours, choose a
weather fallback, and detect when a micro-split may suit the group. They never silently overwrite
survey answers and never become hard constraints without confirmation.

| Signal class | Examples | Authority and lifetime |
| --- | --- | --- |
| Confirmed facts / hard constraints | Peanut allergy, halal requirement, mobility threshold | Explicit survey/manual confirmation is authoritative. Chat may only create a review candidate. Persists until the member edits or deletes it. |
| Stable soft preferences | Budget lean, pace, broad travel vibe, surprise tolerance | Explicit survey answer is the baseline. Chat can temporarily reweight recommendations but cannot overwrite it. |
| Contextual discovery signals | "Somewhere indoors this afternoon", "I'd love live jazz", a shared heritage-market link | Derived from trip-scoped content, visible and removable by the member. Scoped to a moment, day, or trip and expires automatically. |

When signals disagree, safety is resolved first by the hard-constraint gate, explicit recent user
requests outrank older inferred interests, and the survey remains the fallback after contextual
signals expire. The UI must explain material recommendations with both the signal and its source,
for example: "Suggested because the group recently mentioned architecture and cafes."

Two visibility tiers apply throughout: a **public** answer is visible to the rest of the group for
coordination; a **private** answer (the social-role step, by default) is visible only to the
arbiter logic server-side, never returned to another member's client -- the same social-face
protection Task 1.5's blind-preference ballot already gives budget answers.

Survey completion never freezes a member's profile. An always-available **My Travel Preferences**
screen lets the member revisit individual answers without repeating the whole wizard. Stable soft
preferences replace the previous value and affect future ranking/generation immediately; they do
not rewrite the active itinerary. Editing a safety-critical constraint enters the same explicit
confirmation path as its initial creation, and removing or reducing a confirmed severe constraint
records the actor and supersedes the old row rather than erasing its audit trail. After any edit
that could materially affect the current plan, the UI offers **Apply to future suggestions** or
**Review current itinerary**. Review re-runs deterministic validation and produces a visible
pending diff through the standard confirmation primitive; it never silently activates changes.
Newly stricter safety requirements immediately mark affected active items as requiring review even
though the itinerary itself remains unchanged. Public coordination may state that requirements
changed, but never reveal fields marked private (such as private budget or social role) or medical
detail beyond the confirmed typed constraint flags required for group safety. A member's separate
privacy/deletion request still hard-deletes their profile and constraint data under Section IX.

| Step | UI | Feeds | Mechanism |
| --- | --- | --- | --- |
| 1. Travel vibe | Single-select image cards: heritage, food, nature, urban. | Module 5 exploration engine | Seeds the stable baseline of `interest_vector`; chat-derived discovery signals may temporarily reweight it. |
| 2. Dealbreaker vault | Multi-select toggle chips: halal, vegetarian/vegan, named allergens, mobility access, a walking-distance cap. | Task 1.1 `trip_constraints` | Each chip is a direct, self-confirmed write to the existing typed dietary/mobility enum -- the same self-confirmation model the dietary picker already uses, not a second constraint system. |
| 3. Energy & wallet | Two sliders: budget lean, pace. | Module 2 Knapsack; the existing `pace_level` enum | Pace reuses the trip's existing relaxed/balanced/active/intense scale and `paceDailyDurationCaps` rather than inventing a second one; budget seeds the member's personal cost-tier lean inside the group's shared Knapsack objective. |
| 4. Social role | Single-select carousel (Navigator, Chronicler, Gourmand, Go-with-the-flow, Negotiator); private by default. | Level 0 jigsaw minimax regret | A per-member regret-weight multiplier on `evaluateTeam`'s scoring -- see the Task 3.0 addendum below. |
| 5. Surprise dial | A single 1-5 dial. | Module 5 `ε`-greedy recommender | Sets the per-trip `ε` (already spec'd in Task 5.1 as "default 0.2, configurable per trip") directly from the dial position, mapped linearly across 0.0-0.3. |

**Group Conductor:** once three or more members complete the questionnaire, the leader sees an
aggregate "Harmony Compass" -- overlapping vibe choices, a pace-mismatch warning ("2 Marathoners
vs. 1 Snail -- expect a Level 2 micro-split"), and a consensus forecast. This is a read-only
summary over already-confirmed `trip_constraints` and `traveler_profiles` rows; it opens no new
write path and no new trust boundary.

**Safety note:** none of this bypasses [Section VII](#vii-hard-constraint-gate). The dealbreaker
vault writes the exact typed-enum rows the hard-constraint gate already enforces, not a second,
competing constraint system. The vibe check and surprise dial only ever bias which gate-`pass`
candidates get suggested first -- a `fail` from Section VII is terminal regardless of onboarding
answers or chat-derived signals. If chat appears to disclose a hard constraint, the system shows
the affected member a Confirm / Edit / Reject card; until confirmation, the candidate is inert.

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
│                    Web client interaction layer                        │
│   Collaborative workspace  (Next.js route, React 19)                   │
│   - Top 60%: Google 3D/vector map, tilted camera, split/merge routes    │
│   - Bottom 40%: realtime chatroom, AI assistant, action sheet           │
│   - Pre-trip: categorized POI pool + one-day 24h timeline builder       │
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
│  Google Maps / Places / Routes · OpenWeatherMap · social fetchers       │
└────────────────────────────────────────────────────────────────────────┘

Control boundary:
Gemini drafts and enriches. The Python service computes feasibility and optima.
Next.js validation + Supabase policies decide what is saved, shown, and active.
Humans confirm every state change.

Future Phase 10 boundary:
Android (Kotlin / Compose) → versioned HTTPS contracts + Supabase Auth/Realtime.
It does not call the private optimizer or Gemini directly and does not embed the web application.
```

### Web-first, mobile-ready client contract

- Phases 0–9 ship and validate the responsive web/PWA experience first. Android work does not
  delay the hard-constraint gate, optimizer, or web acceptance path.
- Keep authorization, revision checks, idempotency, confirmation, and the hard-constraint gate
  server-authoritative. A mobile client is never trusted to reproduce these rules correctly.
- Every operation needed by both web and mobile has a versioned HTTPS/JSON endpoint with stable
  machine-readable errors. Next.js server actions may wrap these endpoints for web ergonomics but
  must not become an exclusive transport.
- Publish schemas from one contract source and verify the same fixtures with Zod, Pydantic, and
  Kotlin serialization. Do not manually maintain three subtly different payload definitions.
- Share contracts and behavior, not UI code. React components, CSS, browser storage, and Next.js
  server actions are not imported, embedded, or mechanically translated into Android.
- Design mutations for retries: idempotency key, expected revision, authorized actor, and explicit
  confirmation token where applicable. Offline clients queue intentions, not already-approved state.
- Android receives no Gemini, optimizer, database-service, or unrestricted provider secret. It
  uses the authenticated public client boundary and narrowly restricted platform tokens only when
  a native SDK truly requires one.

### Mapping-provider decision and content boundary

- Use one Google Maps Platform family for map display and Google-sourced map content: Maps
  JavaScript API on web, Places API (New) for transient discovery/details, Routes API for walking,
  driving, cycling, and public transit, and Maps SDK for Android if Phase 10 map features proceed.
- Do not render Google Routes, Places, Directions, Distance Matrix, or Route Optimization content
  on a Mapbox, OpenStreetMap, or other non-Google map. Current Google service-specific terms
  prohibit that combination. Re-check the current terms before each provider launch.
- `ComputeRouteMatrix` supplies travel times/distances to WanderSync's own OR-Tools model;
  `ComputeRoutes` supplies the final user-visible route legs. Google does not decide subgroup
  membership, itinerary utility, hard constraints, or confirmation.
- Transit routes have different capabilities from road routes, including restrictions on
  intermediate waypoints. Build each transit leg between solver-selected stops and validate the
  final connection/arrival time rather than assuming a multi-waypoint transit request.
- `poi_catalog` is WanderSync-owned reference data collected from independently reviewable sources.
  Google Places can discover candidates and refresh permitted display details, but must never be
  copied wholesale into the permanent catalog or treated as evidence of halal/allergen safety.
- Store Google place IDs only where permitted and enforce the provider's current caching limits for
  coordinates and other content. Keep provider-derived fields separate from owned safety metadata,
  with provider name, retrieval time, and expiry.
- Use separate restricted keys: a referrer-restricted public browser key for Maps JavaScript, a
  server-only key restricted to Places/Routes from the backend, and later a package/signing-
  certificate-restricted Android key. Billing budgets, quotas, and alerts are required before launch.

## V. Service boundary (Next.js ↔ Python optimization service)

**Next.js owns**

- Server-side authentication verification, web session handling, and all privileged/RLS-scoped
  orchestration. Private credentials live only here. A Phase 10 Android client may contain only the
  public Supabase project configuration and its current user's securely stored session token.
- The web collaborative workspace: realtime chat, presence, the embedded assistant, and the
  flashcard timeline, all served as Next.js routes. Android later implements native screens against
  the shared contracts; it does not reuse or embed these React routes.
- All Gemini calls: intent extraction, "Switch It Up" narration, orientation cues, VQA, detour copy.
- The **hard-constraint gate**: no itinerary item is persisted or shown as approved until it passes.
- Orchestration: builds solve payloads, enqueues jobs, applies solutions, pushes confirmations.
- All server-side external-provider calls (Google Places/Routes, OpenWeatherMap, social fetchers).
  The browser loads Google Maps only with its referrer-restricted public key; it never receives the
  server Places/Routes key.

**Python optimization service owns**

| Endpoint | Responsibility |
| --- | --- |
| `POST /solve/schedule` | Multi-objective Knapsack over candidate activities with total / daily / per-meal caps; returns selected set + slack per cap. |
| `POST /solve/cluster` | K-Means / GMM over interest vectors + budget capacity; returns branch assignments. |
| `POST /solve/route` | m-VRPTW with time windows, sub-branches, and a consensus anchor; returns ordered waypoints + arrival times per branch. |
| `POST /solve/sun` | SunCalc azimuth/elevation for coordinates + date; returns golden- and blue-hour windows. |
| `POST /solve/reoptimize` | Partial DAG retopology given a trigger and a locked set; returns a minimal diff. Accepts `accumulated_cost` and `remaining_budget_cap`; when `remaining_budget_cap < planned_cost` for the unvisited tail, runs a budget-recovery pass instead of only a weather/detour diff (Task 7.2). |
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

- `traveler_profiles` — per member: `interest_vector vector(64)` (the explicit survey baseline), `budget_daily_cap numeric`, `budget_total_cap numeric`, `pace`, `mobility_threshold_m int`, `serendipity_epsilon numeric` (0.0-0.3, Task 1.6's surprise dial), `social_role` enum (Task 1.6; private -- never returned in a cross-member API response). Chat inference never overwrites these fields. **No free-text medical data.**
- `trip_interest_signals` — derived discovery tags from chat, pasted text, voice, or public-link captions: `trip_id`, nullable `trip_member_id`, typed `tag`, `source`, `confidence`, `scope` (`moment` | `day` | `trip`), `source_message_id` when applicable, `expires_at`, and dismissal metadata. Store the derived tag and a short user-visible source label, not copied raw third-party content. Members can inspect and dismiss their own inferred signals; RLS prevents cross-trip access.
- `trip_constraints` — hard constraints as typed rows: `kind` (`dietary` | `religious_access` | `mobility`), `flag` (enum), `severity` (`severe` | `standard`), `source` (`chat` | `voice` | `social` | `manual`), `confirmed_by`, `confirmed_at`. Nothing is enforced until `confirmed_at` is set.
- `trip_day_windows` — one row per participating member and trip-local date: `trip_member_id`, `local_date`, `available_from time`, `preferred_start time`, `finish_by time`, `timezone text`, and `revision`, unique on `(trip_member_id, local_date)`. `available_from` / `finish_by` are hard scheduling bounds; `preferred_start` is a visible soft preference. Defaults are explicit and editable before generation, never inferred silently from pace or browser timezone.
- `poi_catalog` — WanderSync-owned curated POIs: `geog geography(Point,4326)` (PostGIS), nullable `provider_place_id`, independently written `short_description`, `official_url`, `cost_tier`, `tags text[]`, `halal_status` (`verified` | `claimed` | `unknown` | `no`), `allergen_risk text[]`, `indoor bool`, `dress_code` enum, `tourist_density` enum, `height_m numeric` (nullable), `landmark_class` (`prominent_structure` | `global_storefront` | `architectural_typology` | null) for deterministic landmark grounding (Task 6.1). Provider descriptions and hours remain provider content and are not copied into these owned fields.
- `itinerary_dag` — nodes (activities, transits) + edges with time windows; `locked bool` for visited or fixed-reservation nodes; supports partial re-optimization.
- `subgroups`, `subgroup_members`, `split_sessions` — branch assignments, rendezvous point (`geog`), convergence time.
- `mobility_options` — computed Fastest / Budget / Scenic legs with cost, duration, and `weather_sensitive bool`.
- `expenses`, `expense_shares` — receipt-OCR ledger; deterministic split; append-only with reversing entries.
- `packing_items` — checklist rows with `reason` (`weather` | `dress_code` | `medical` | `shared`) and `claimed_by`.
- `chat_messages` — append-only trip chat: `author_member_id`, `author_kind` (`member` | `assistant` | `system`), `body`, optional `proposal_id` referencing `agent_proposals`, `status`. Broadcast over `trip:{trip_id}`, but visibility enforced by RLS, never by the channel name.
- `serendipity_log` — surfaced exploration POIs plus accept/dismiss outcome, feeding the diversity and dedupe guardrail.
- `heal_events` — trigger, diff applied, confirmation state.
- Redis keys (ephemeral, TTL'd): `trip:{id}:loc:{member}` live location, `trip:{id}:session` state-machine cursor, `trip:{id}:lock` re-optimization mutex, `trip:{id}:blind:{salted_ref}` a salt-hashed blind-preference ballot (`budget_tier`, hidden dislikes) keyed by a per-session salt rather than the member id, so the arbiter can read the set without attributing any single ballot (Task 1.5).
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
| **Time** | Every activity and transit block stays inside that date's `available_from` / `finish_by` window; no overlap, no midnight crossing, and arrival at the consensus anchor no later than the convergence time. A soft `preferred_start` may move only with a visible explanation. |

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

**Files:** create `supabase/migrations/2026090X0001_traveler_profiles_constraints.sql`, `lib/domain/constraints.ts`, `tests/domain/constraints.test.ts`, `tests/database/constraints-rls.test.ts`, `supabase/seed.sql`, `scripts/seed_kl_reference.ts`. Enable the `postgis` and `vector` extensions.

- [ ] Add `traveler_profiles`, `trip_constraints`, and `poi_catalog` with trip-scoped RLS matching the existing policies.
- [ ] `trip_constraints` rows are inert until `confirmed_at` is set; enforcement reads go through a view that filters `confirmed_at is not null`.
- [ ] Typed enums for `dietary` / `religious_access` / `mobility` flags and for `severity`; reject free text in flag columns at the database level.
- [ ] Contract and PGlite RLS tests: owner/planner write, member read, unrelated denial, unconfirmed rows excluded from the enforcement view.
- [ ] Bootstrap seed harness: a deterministic script (`scripts/seed_kl_reference.ts`, invoked via `supabase/seed.sql` for local resets) pre-populates 40–50 hand-verified `poi_catalog` rows for the reference corridor (KLCC, Bukit Bintang, Old Town/Melaka), with real `halal_status`, `allergen_risk`, `indoor`, `dress_code`, and (Task 6.1) `landmark_class` values — commercial map APIs do not carry these fields, so every downstream feature needs this ground truth rather than synthetic mocks. Idempotent: re-running does not duplicate rows.
- [ ] Run lint, test, build.

### Task 1.2: Contextual discovery and candidate-constraint extraction

**Files:** create `supabase/migrations/2026090X0002_interest_signals.sql`, `lib/ingestion/{chat,voice,social}.ts`, `lib/ingestion/extract.ts`, `lib/domain/interest-signals.ts`, `app/api/trips/[tripId]/ingest/route.ts`, `app/api/trips/[tripId]/interest-signals/route.ts`, `tests/ingestion/*.test.ts`, `tests/domain/interest-signals.test.ts`, `tests/database/interest-signals-rls.test.ts`.

- [ ] Chat: incrementally read the trip's own new `chat_messages`, and accept explicitly pasted text from an outside group chat. Do not repeatedly reprocess the full history.
- [ ] Voice: accept audio, transcribe via Gemini, feed the text to the extractor.
- [ ] Social: fetch Instagram / TikTok / Xiaohongshu URLs through a pluggable fetcher interface with per-host adapters. **Caption and oEmbed text only**; respect robots and rate limits; no login-walled scraping. Store only derived interest tags, never raw third-party content.
- [ ] `extract.ts`: one Gemini call → structured JSON with `discoverySignals[]` (`tag`, `confidence`, `scope`, `sourceLabel`) and `candidateConstraints[]` (`kind`, `flag`, `severity`, `evidence`) → Zod. A deterministic post-filter allowlists signal tags, clamps `scope` to an expiry, and maps constraint evidence to typed enum flags. Anything unmapped becomes a manual review item and is never auto-enforced.
- [ ] Persist discovery signals separately from `traveler_profiles`: `moment` expires after the relevant itinerary window, `day` at the end of the destination-local day, and `trip` at trip end. Repeated equivalent signals refresh one row rather than accumulating duplicates.
- [ ] Provide a "Why am I seeing this?" source label and an inferred-interest control where a member can dismiss their own signal. Dismissal immediately removes it from future ranking and prevents the same source message from recreating it.
- [ ] Feed active discovery signals into attraction search, Safe / Local / Wildcard ranking, spontaneous detours, weather alternatives, and split-suggestion detection. They are ranking inputs only; every surfaced candidate still passes the hard-constraint gate.
- [ ] Fake-client tests: valid attraction-interest extraction, contextual `indoor_today` expiry, deduplication, dismissal, malformed JSON, ambiguous evidence, and prompt injection inside ingested text (must not create a constraint, overwrite a survey answer, or exfiltrate trip data).
- [ ] Rate-limit ingestion per user and per trip.

### Task 1.3: Confirmation & interest-vector build

**Files:** create `components/constraint-review.tsx`, `lib/domain/interest-vector.ts`, `app/actions/constraints.ts`, `tests/components/constraint-review.test.tsx`, `tests/domain/interest-vector.test.ts`.

- [ ] UI lists each candidate constraint with its evidence and a one-tap Confirm / Edit / Reject. Nothing is enforced until an authorized member confirms.
- [ ] `severe` flags require confirmation from the affected member, or from the owner acting on their behalf with the actor logged.
- [ ] Deterministic embedding of explicit survey tags into the baseline `interest_vector` via a fixed tag→dimension map. Build a separate, ephemeral contextual vector from active `trip_interest_signals`; combine the two only at read/ranking time. No LLM in either vector write path.
- [ ] Weighting rule: an explicit current-turn request outranks older contextual signals; active contextual signals may reweight but not erase the survey baseline; expired or dismissed signals contribute zero. The calculation is deterministic under a supplied clock.
- [ ] Tests: confirm enforces, reject discards, edit re-maps, unauthorized actor denied, severe flag cannot be confirmed by an unrelated member, contextual signals change attraction ranking without modifying the stored baseline, and expiry restores baseline ranking.

### Task 1.4: Hard-constraint gate

**Files:** create `lib/domain/constraint-gate.ts`, `tests/domain/constraint-gate.test.ts`. Modify `lib/domain/gemini-proposal-validation.ts`.

- [ ] Implement the gate exactly as [Section VII](#vii-hard-constraint-gate): `pass` | `warn` | `fail` with a machine-readable reason.
- [ ] `unknown` allergen or halal data fails closed for `severe` flags and warns otherwise.
- [ ] Pure function over `(item, confirmedConstraints, travelerCaps)`; no I/O, no clock reads.
- [ ] Exhaustive table tests for dietary, halal, dress code, budget upper bound, mobility, and time.
- [ ] Wire the gate into the existing proposal-validation path so today's Gemini proposals also pass through it.

### Task 1.5: Blind preference alignment

**Files:** create `lib/domain/blind-preferences.ts`, `lib/redis/blind-ballot.ts`, `app/api/trips/[tripId]/blind-preferences/route.ts`, `components/blind-preference-drawer.tsx`, `tests/domain/blind-preferences.test.ts`, `tests/chat/blind-arbiter.test.ts`.

Public confirmation (Task 1.3) works for facts a member is willing to say out loud. It does not cover social friction: nobody wants to be the one who says a restaurant is too expensive or admits fatigue in a channel the whole group can read.

- [ ] Ballots (`budget_tier: "BUDGET" | "COMFORT" | "LUXURY"`, plus optional hidden dislikes) are written to the salt-hashed `trip:{id}:blind:{salted_ref}` Redis key from [Section VI](#vi-persistence-model), never to a row an authorized member can attribute back to a person. The salt is per trip-session and is never logged alongside the member id.
- [ ] Arbiter logic is a pure conservative-intersection reducer: the team's anchor dining/activity ceiling locks to the **lowest** `budget_tier` present in the ballot set, and any hidden dislike removes matching candidates from the pool the same way a confirmed constraint would, without the dislike itself ever being surfaced.
- [ ] The assistant states only the aggregate outcome in chat — "Based on combined group criteria, here are 3 matching options" — and never the ballot count, the per-member values, or who dissented. Test that no chat message, log line, or API response can be used to reconstruct an individual ballot from the aggregate.
- [ ] Ballots are advisory input to Task 2.3's Knapsack ceiling and Task 5.1's exploitation ranking; they never bypass the [hard-constraint gate](#vii-hard-constraint-gate), which stays keyed to confirmed, non-anonymous `trip_constraints`.
- [ ] Tests: lowest tier wins regardless of submission order, a hidden dislike filters candidates without leaking into any response, ballots expire with the Redis TTL, re-submission overwrites rather than duplicates a member's own ballot.

### Task 1.6: Onboarding questionnaire (Travel DNA)

**Files:** create `supabase/migrations/2026090X0006_onboarding_profile.sql`, `components/onboarding-wizard.tsx`, `components/travel-preferences-editor.tsx`, `app/actions/onboarding.ts`, `app/trips/[tripId]/onboarding/page.tsx`, `app/trips/[tripId]/preferences/page.tsx`, `app/api/trips/[tripId]/onboarding/summary/route.ts`, `app/api/trips/[tripId]/preferences/route.ts`, `tests/components/onboarding-wizard.test.tsx`, `tests/components/travel-preferences-editor.test.tsx`, `tests/database/onboarding-rls.test.ts`.

See [Section II-a](#ii-a-hybrid-preference-model-compact-survey-and-contextual-chat-learning) for the compact five-screen design and its
mapping onto the modules above.

- [ ] Five-step wizard plus a "Quick mode" toggle on step one (dealbreakers and budget only, the
      rest defaulted); one primary interaction per screen, no free-text fields, under 60 seconds
      to complete, and every default remains visible and editable later.
- [ ] Steps 1, 3, and 5 write `traveler_profiles` (`interest_vector` seed, `pace`,
      `serendipity_epsilon`); step 2 writes `trip_constraints` rows through the existing
      self-confirmed path from Task 1.1, not a second constraint system; step 4 writes
      `traveler_profiles.social_role`, defaulting to private.
- [ ] `pace` reuses the trip's existing `pace_level` enum. This step does not introduce a second
      pace scale.
- [ ] `social_role` is never included in any API response readable by a member other than its
      owner; only server-side jigsaw evaluation logic (Task 3.0's regret-weight addendum) reads it.
- [ ] Redoing the questionnaire overwrites the previous answer per field; it never accumulates
      history. Chat-derived discovery signals never write to or overwrite questionnaire fields.
- [ ] Provide an always-available **My Travel Preferences** editor after onboarding. A member can
      change one field without repeating the wizard; soft preference writes are revision-checked,
      idempotent upserts and affect only subsequent ranking/generation by default.
- [ ] Safety-critical additions, edits, removals, or severity reductions use Task 1.3's explicit
      confirmation flow. A severe change requires the affected member, or an owner acting on their
      behalf with the actor recorded. Supersede the previous confirmed row instead of deleting its
      audit history during an ordinary edit; a Section IX privacy/deletion request still removes the
      member's data. No chat inference may perform either operation.
- [ ] After a material edit, offer **Apply to future suggestions** and **Review current itinerary**.
      The first leaves the active itinerary byte-for-byte unchanged. The second re-runs the gate and
      schedule checks and creates a pending minimal-diff proposal using Task 3.5's confirmation
      primitive. A stricter safety edit immediately flags affected active cards as requiring review,
      but never silently removes, replaces, or activates an item.
- [ ] Realtime announces a generic requirements/preferences change to the group without exposing
      private budget caps, `social_role`, or medical detail beyond confirmed typed flags. Only the
      owning member sees their complete fields marked private.
- [ ] "Group Conductor" summary endpoint: vibe overlap, a pace-mismatch flag (both an
      `active`/`intense` and a `relaxed` pace present among confirmed members), and a consensus
      percentage, computed read-only from already-confirmed rows.
- [ ] Tests: quick mode skips steps 3-5 with sane defaults, each step's answer lands in the field
      the Section II-a table specifies, `social_role` never appears in a cross-member response,
      redoing the questionnaire replaces rather than duplicates rows, the pace-mismatch flag fires
      only when both extremes are present among confirmed members; editing one soft preference
      changes future ranking without mutating the active itinerary; a safety edit requires
      confirmation and preserves its audit trail; concurrent stale edits fail; itinerary review
      creates a pending diff; and group events contain no private value.

**Phase 1 exit criteria:** the compact survey establishes an explicit, later-editable baseline; ingested chat, voice, and social input produce expiring discovery signals and candidate constraints; a chat message about live jazz changes attraction ranking without changing the stored survey vector; a day-scoped indoor request expires after that day; dismissed inferred interests do not reappear from the same source; only human-confirmed constraints are enforced; the gate rejects a peanut-risk food POI and an unverified-halal POI in an automated test; a blind ballot set with one `BUDGET` vote locks the group ceiling to `BUDGET` without exposing who voted it; a completed onboarding questionnaire seeds `interest_vector`, `pace`, `serendipity_epsilon`, and a private `social_role` without leaking the latter to other members; editing a soft preference changes future suggestions without silently changing the active itinerary, while reviewing that itinerary creates only a confirmable pending diff; the reference-corridor seed data loads cleanly; the open baseline items above are closed.

### Task 1.7: Daily planning windows before generation

**Files:** create `supabase/migrations/2026090X0007_trip_day_windows.sql`, `components/trip-day-windows.tsx`, `app/api/trips/[tripId]/day-windows/route.ts`, `lib/domain/day-window.ts`, `tests/components/trip-day-windows.test.tsx`, `tests/api/day-windows.test.ts`, `tests/database/day-windows-rls.test.ts`.

- [ ] Before **Generate plan**, show one row per destination-local date with preset start choices
      (07:00, 08:00, 09:00, 10:00), a custom-time option, and an optional **Finish by** value.
      Copying one day's values to all days is a convenience, not an irreversible bulk edit.
- [ ] Store each participating member's `available_from` as a hard lower bound,
      `preferred_start` as a soft preference, and `finish_by` as a hard upper bound in
      `trip_day_windows`; validate `available_from <=
      preferred_start < finish_by` and use the destination IANA timezone, never the browser's
      timezone. Surface any default before generation and keep every value editable afterward.
- [ ] For groups, do not average away availability. The shared solver window begins at the latest
      hard `available_from` among participating members. A differing soft preference may shift with
      an explanation; an optional early-bird branch may start earlier and rejoin at a feasible
      anchor, but it is never created or activated without confirmation.
- [ ] Pass every date's bounds and preference into Tasks 2.3 and 4.2. Reject generation when a hard
      window is empty or cannot contain required reservations; otherwise return a pending proposal
      and explain material movement away from `preferred_start`.
- [ ] Tests: preset and custom time, copy-to-all, destination-timezone behavior across DST,
      invalid/empty window, latest hard group availability, soft-preference explanation, and an
      early-bird suggestion that leaves the active itinerary unchanged until confirmed.

**Updated Phase 1 exit criterion:** generation has an explicit destination-local planning window
for every trip day; the reference proposal starts no earlier than its hard bound, materially moving
away from the preferred start produces an explanation, and an infeasible window blocks generation
with a useful message.

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
- [ ] Pack activities and required transit inside each Task 1.7 hard daily window; treat
      `preferred_start` as a penalized soft deviation rather than a hard equality, and report the
      deviation when the selected schedule starts materially earlier or later.
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
60%** is the Google 3D/vector spatial map, the **bottom 40%** is the realtime chatroom and action sheet.
Pre-trip mode replaces the whole surface with the full-screen **day builder**: a categorized POI
choice pool beside one selected date's 24-hour timeline. Only one date is rendered at a time; a
date strip switches days without discarding edits. The pool is a desktop side panel and collapses
to a bottom drawer on narrow screens. See `docs/features/collaborative-workspace.md`.

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
- [ ] Per-member regret-weight multiplier on `evaluateTeam`, sourced from the Task 1.6 onboarding
      social-role answer, so a Gourmand's meal anchor and a Navigator's minor preference are not
      weighed as if they mattered equally to both people (folds into Task 1.6).

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

### Task 3.4: Calendar timeline editing, persistence, and synchronization

**Files:** create `features/timeline/` (`timeline-pane.tsx`, `date-selector.tsx`, `day-column.tsx`,
`activity-card.tsx`, `travel-block.tsx`, `poi-choice-pool.tsx`, `poi-choice-card.tsx`,
`poi-detail-sheet.tsx`, `use-drag-commit.ts`, `use-resize-commit.ts`), `lib/poi/choice-pool.ts`,
`lib/poi/opening-hours.ts`, `supabase/migrations/2026090X0008_poi_choice_metadata.sql`,
`app/api/trips/[tripId]/poi-choices/route.ts`,
`app/api/trips/[tripId]/itinerary/reorder/route.ts`,
`tests/components/timeline/*.test.tsx`, `tests/api/itinerary-reorder.test.ts`.

- [ ] Extend the delivered `JigsawPanel` to a Google Calendar-style vertical **single-day** editor.
      The selected day spans destination-local 00:00-24:00; inactive overnight hours are collapsed
      by default but remain reachable. A keyboard-accessible date strip above the timeline switches
      the selected date, preserves scroll/edit state per day, and never renders all trip days at
      once. Blocks are positioned by local start time and height is proportional to duration.
- [ ] Add a choice pool beside the timeline on desktop and as a bottom drawer on narrow screens.
      Categorize candidates through a deterministic canonical mapping (`food`, `nature`, `shopping`,
      `heritage`, `culture`, `entertainment`, `local_wildcard`) over owned/provider tags; support
      category tabs and search without asking Gemini to classify during rendering.
- [ ] `choice-pool.ts` merges curated `poi_catalog` rows with transient Google Places results,
      resolves/deduplicates by provider Place ID and conservative name/location matching, and keeps
      provenance/trust explicit. The Phase 1 gate decides eligibility before drag; `fail` candidates
      are not draggable and are hidden by default behind an **Unavailable** explanation. Task 5.1
      later ranks the same typed pool rather than creating a second candidate model.
- [ ] Each pool card shows name, thumbnail when permitted, an independently owned or correctly
      attributed provider description, estimated visit duration, cost tier, travel-time estimate,
      opening status, safety badges, trust level (`curated` | `provider` | `unverified`), and **View
      details**. The detail sheet shows the full description, sources, official/Google Maps links,
      verification date, hours, and warnings. Never present Google Places data as WanderSync-owned.
- [ ] Drag a pool card onto a valid time to schedule it; dragging an ordinary scheduled block back
      to the pool unschedules the itinerary item but never deletes the POI. Prevent accidental
      duplicate scheduling unless the user explicitly confirms a repeat visit. Highlight feasible
      drop ranges and disable infeasible ranges before drop when the necessary data is known.
- [ ] Drag a scheduled block to change its start time within the selected day. Moving to another day
      is done by switching the date and then placing it from the pool, rather than displaying several
      day columns simultaneously. Pointer-accessible top and
      bottom resize handles change visit duration in 15-minute increments (the existing 30-minute
      bargaining grid remains delivered behavior, but persistence accepts the existing 15-480
      minute domain contract). Provide equivalent keyboard move/resize controls and announce the
      resulting start, end, and duration.
- [ ] Render required travel as separate, visually subordinate timeline blocks between POIs rather
      than hiding it inside attraction duration. A card shows its start, end, duration, lock state,
      and concise safety/opening-hours warning state.
- [ ] A move or resize applies an optimistic local update, then a server-validated write. **Every
      edit is revalidated** against opening hours, transit feasibility, Task 1.7 daily bounds,
      overlap/midnight rules, pace, budget, the Phase 1 constraint gate, reservations, and
      rendezvous deadlines. A refusal rolls the block back and shows the reason on that block.
- [ ] Resolve `provider_place_id` and request Google Places `businessStatus`,
      `regularOpeningHours`, and, when the visit is within the provider's supported near-term range,
      `currentOpeningHours`. Normalize split/overnight periods into destination-local intervals.
      Refresh on generation, detail opening, schedule edit, and shortly before the visit; treat
      regular hours for distant dates as provisional. Follow provider caching/attribution rules.
- [ ] Permanently/temporarily closed POIs and blocks that cannot fit wholly inside an open interval
      are not valid drops. When hours are absent, do not pretend the venue is open: allow an
      authorized explicit placement only with an **Hours unverified — confirm before visiting**
      warning that remains on the block and proposal review.
- [ ] Fixed reservations and consensus anchors are locked by default. Changing one requires an
      explicit unlock/confirmation; resizing an ordinary visit must never silently move a locked
      block. Any proposed downstream auto-shift is previewed as a diff before confirmation.
- [ ] Card states are visually distinct: active, pending proposal, AI-suggested, conflicted.
- [ ] Writes carry the trip revision. A stale revision loses and the client refetches, so two members
      dragging at once cannot silently clobber each other.
- [ ] Remote reorders from other members animate into place over the same `trip:{tripId}` channel,
      with multiplayer presence cursors so asynchronous negotiation is visible. Target: all
      members see a resolved conflict within 500 ms.
- [ ] Tests: one selected date only, keyboard date switching with per-day state preservation,
      desktop pool/mobile drawer, category mapping/search, compact description plus full detail sheet,
      pool-to-timeline and timeline-to-pool drag, duplicate prevention, full 24-hour access with
      overnight collapse, height proportional to duration, pointer/keyboard move and resize,
      15-minute snapping, travel blocks, split/overnight/special/unknown opening hours, rejected edit
      rollback, locked-anchor protection, transit/day-window failure, stale-revision refusal,
      overlap/midnight refusal, attribution, and two-member concurrent edits.

### Task 3.5: Workspace shell & confirmation primitive

**Files:** create `app/trips/[tripId]/workspace/page.tsx`, `features/workspace/workspace-shell.tsx`,
`lib/domain/confirm.ts`, `lib/workspace/focus-bus.ts`, `lib/offline/itinerary-snapshot.ts`,
`tests/components/workspace-shell.test.tsx`, `tests/domain/confirm.test.ts`, `tests/offline/itinerary-snapshot.test.ts`.

- [ ] Dual-pane layout with a responsive tab collapse below the tablet breakpoint.
- [ ] One reusable confirmation primitive: propose → render a confirm affordance → single-use token →
      authorized-actor check → apply → acknowledge. Every later mutating flow (split/merge, expense,
      detour, self-heal, track switch) uses this instead of rolling its own.
- [ ] **Active focus event bus:** tapping a POI card or proposal bubble in the chat pane dispatches an
      event the map pane subscribes to, driving `map.flyTo` the target coordinate and highlighting the
      extruded building. Chat and map stay decoupled — the map never reads chat DOM state directly.
- [ ] **Touch arbitration:** the 60/40 split is two independent gesture surfaces. When the bottom chat
      sheet is dragged past 40% height, the map is set `interactive: false` (no pan, pinch, or drag)
      until the sheet settles back, so a chat scroll can never bleed into a map drag.
- [ ] **Offline itinerary snapshot (PWA):** the active day's DAG state and each member's emergency
      contacts are mirrored to client-side storage (IndexedDB) on every successful load, so a signal
      drop mid-transit still shows the current plan and who to call, read-only, with a visible
      "offline — last synced HH:MM" banner rather than a blank or stale-looking screen.
- [ ] Tests: replay, expiry, wrong actor, double-accept, responsive collapse, map ignores pointer
      events while the chat sheet is expanded past 40%, offline snapshot renders the last-synced plan
      with airplane mode simulated in a Playwright test.

**Phase 3 exit criteria:** two signed-in members of the same trip see each other's messages and
presence live; the assistant answers an `@ai` question and posts a proposal card that only an
authorized member can accept; selecting a date shows only that day's 24-hour calendar and a
categorized POI pool; dragging a described POI into a valid slot, moving it, or resizing it persists
for both members, keeps travel time visible, and is refused with a visible reason when it breaks
opening hours, schedule, or constraint rules; tapping a chat POI card flies the
map to it while the map ignores gestures whenever the chat sheet is expanded past 40%; simulated
airplane mode still renders the last-synced itinerary and emergency contacts.

---

## Phase 4 — Group routing, split & merge, mobility (Modules 5 & 6)

### Task 4.1: Traveler clustering

**Files:** create `services/optimizer/app/solvers/cluster.py`, `services/optimizer/tests/test_cluster.py`, `app/api/trips/[tripId]/subgroups/suggest/route.ts`, `tests/api/subgroups.test.ts`.

- [ ] K-Means / GMM over `interest_vector` plus normalized budget capacity; configurable branch count (2–3).
- [ ] Deterministic under a seed. Return the assignment plus per-branch feature weights; the human-readable rationale is generated in Next.js, not the solver.
- [ ] Tests: separable interests cluster cleanly, an all-similar group falls back to a single branch, a budget outlier is not isolated alone unless interests also diverge.

### Task 4.2: m-VRPTW routing with a consensus anchor

**Files:** create `services/optimizer/app/solvers/route.py`, `services/optimizer/tests/test_route.py`, `app/api/trips/[tripId]/route-plan/route.ts`, `tests/api/route-plan.test.ts`.

- [ ] OR-Tools routing: per-branch ordered waypoints, time windows, a travel-time matrix supplied by Next.js through Google Routes `ComputeRouteMatrix`, and a shared rendezvous node every branch must reach by the convergence time.
- [ ] Return arrival times and slack; report infeasible if a branch cannot make the anchor.
- [ ] Tests: two branches converge on time, a tightened window becomes infeasible rather than silently late, an added stop reflows downstream arrivals.

### Task 4.3: Split / merge flow

**Files:** create `supabase/migrations/2026090X0003_subgroups.sql`, `lib/domain/subgroups.ts`, `lib/domain/merge-recommendation.ts`, `lib/domain/micro-zone-split.ts`, `features/workspace/split-merge-panel.tsx`, `tests/domain/{subgroups,merge-recommendation,micro-zone-split}.test.ts`, `tests/components/split-merge.test.tsx`.

- [ ] `subgroups`, `subgroup_members`, and `split_sessions` with trip-scoped RLS; rendezvous stored as PostGIS `geog`.
- [ ] The split panel proposes branches from Task 4.1 behind the Task 3.5 confirmation primitive; members may move themselves between branches before confirming. Gemini may suggest branches but must never assign people.
- [ ] **Level 2 micro-zone split:** a lower-impact mode for energy or pace mismatches inside a single 300 m radius (the [conflict-resolution framework's](#ii-b-progressive-conflict-resolution-framework) Level 2, distinct from the macro Level 3 split above). The low-energy member is routed to a nearby climate-controlled cafe or bench from `poi_catalog` while the rest of the group keeps moving within the same zone; `split_sessions.kind = 'micro_zone'` enforces a walking-time-to-rendezvous cap (2 minutes) instead of the wider merge-anchor math, so nobody is routed out of casual reach.
- [ ] **Rendezvous mission metadata:** every `split_sessions` row (both micro-zone and the macro Task 4.1/4.2 split) carries an optional short, human-written goal per branch (e.g. "sample local pastries for dinner" / "scout the sunset vantage point"), surfaced on the split-merge panel and the reunion proposal card. This is copy, not a scored objective — it gives the branches something to compare notes on at reunion instead of the split reading as one person being sidelined.
- [ ] Deterministic ETA guidance bands on merge:

```text
0–20 minutes:  wait at the named rendezvous anchor
21–60 minutes: suggest a low-commitment nearby pause
61+ minutes:   continue to the next fixed commitment
```

- [ ] Per-branch budget caps enforced by the [gate](#vii-hard-constraint-gate) after assignment.
- [ ] Tests: the three ETA bands, non-member assignment rejected, unauthorized split rejected, merge completion is confirmation-first, a micro-zone split's rendezvous is refused if it exceeds the 2-minute walking cap, mission metadata round-trips onto the reunion card.

### Task 4.4: Multi-modal mobility decisions

**Files:** create `lib/mobility/breakeven.ts`, `lib/mobility/options.ts`, `app/api/trips/[tripId]/legs/[legId]/mobility/route.ts`, `tests/mobility/*.test.ts`.

- [ ] Rideshare break-even: compare a 3–4-passenger ride-hail fare estimate against summed transit fares for the branch size. Deterministic given quoted prices.
- [ ] Emit Fastest / Budget / Scenic-Walk options with cost and duration from Google Routes. Build public-transit legs with `travelMode = TRANSIT`, respecting the transit endpoint's waypoint limitations and preserving required Google attribution/warnings.
- [ ] A rain trigger (from the Phase 7 monitor or a manual flag) marks weather-sensitive legs and prefers covered or indoor connections.
- [ ] Keep routes text- and map-based; no live vehicle tracking.
- [ ] Tests: break-even flips at the expected party size, the scenic option only appears when it fits the time budget, the rain pivot changes the recommendation.

**Phase 4 exit criteria:** the reference trip produces two interest-clustered branches routed to a shared 18:00 anchor with feasible arrival times; a merge request returns the correct ETA-band guidance; a leg shows all three mobility options with a rideshare break-even; a simulated energy mismatch produces a Level 2 micro-zone split within the 2-minute rendezvous cap, with mission metadata attached to both branches.

---

## Phase 5 — Serendipity & exploration engine (Module 5)

### Task 5.1: ε-greedy recommender

**Files:** create `lib/serendipity/recommender.ts`, `lib/serendipity/diversity.ts`, `tests/serendipity/*.test.ts`.

- [ ] Exploitation set: rank POIs against the explicit survey baseline plus active, non-dismissed contextual discovery signals from Task 1.2. A current-turn request receives the highest soft-preference weight; expired signals contribute zero. Exploration set: sample high-variance POIs (low baseline similarity, distinct tags, still gate-`pass`) with probability ε, default 0.2 and configurable per trip.
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
- [ ] Prefer detours matching active `moment` or `day` discovery signals (for example, a recent request for live music or somewhere indoors), and explain which recent signal influenced the suggestion. A contextual match changes ranking only; it cannot bypass feasibility, dedupe, or the hard-constraint gate.
- [ ] Tests: no offer when the buffer is too small, the offer respects the dinner reservation, accepting keeps the anchor arrival feasible, a recent contextual signal changes the top eligible attraction, and an expired or dismissed signal does not.

**Phase 5 exit criteria:** the reference trip's 20% blend yields at least one gate-clean out-of-profile POI; Safe, Local, and Wildcard variants all satisfy Ben's allergy flag and Amira's Halal constraint; a simulated 30-minute buffer produces a detour offer that still makes the 18:00 anchor.

---

## Phase 6 — On-site execution: navigation, photo, packing (Modules 3, 7, 8)

### Task 6.1: 3D landmark navigation

**Files:** create `features/workspace/google-map-3d.tsx`, `lib/providers/google-maps.ts`, `lib/providers/google-places.ts`, `lib/providers/google-routes.ts`, `lib/nav/landmarks.ts`, `lib/nav/orientation-cues.ts`, `tests/nav/*.test.ts`, `tests/providers/google-maps-contract.test.ts`.

- [ ] Google Maps JavaScript API vector/3D view with a tilted camera following the active leg, subgroup polylines, rendezvous markers, and the next eligible landmark highlighted. Prefer `Map3DElement` where supported and provide an accessible 2D vector-map fallback when 3D/WebGL is unavailable.
- [ ] **Deterministic landmark pre-filtering (`lib/nav/landmarks.ts`), before any Gemini call:** run a
      spatial query against the WanderSync-owned `poi_catalog` within `r <= 50m` of the upcoming
      turn/intersection coordinate, filtered to `landmark_class` in (`prominent_structure` with
      `height_m > 30`, `global_storefront`, `architectural_typology`). This candidate list, not the raw
      Google map/Places response, is what reaches the LLM — an empty result means no landmark
      candidate at all. A transient Google Places result is display-only until independently
      reviewed into owned catalog data.
- [ ] Conversational cue generation (Gemini) is **strictly grounded**: the prompt supplies only the
      pre-filtered candidate list, and the response is Zod-validated against a schema that permits
      referencing only entities from that list. "Walk toward the clock tower, turn right at the
      McDonald's" is valid only when both named features are in the candidate set for that coordinate;
      an empty candidate list yields plain distance/direction phrasing with no invented landmark name.
- [ ] Tests: a cue references only a real feature present in the passed context, no cue is invented
      when the deterministic pre-filter returns nothing, a candidate outside the 50 m radius or below
      the height threshold is never offered to the LLM, camera and marker state render correctly,
      the 2D fallback works without WebGL, provider attribution is visible, and no Google Places or
      Routes content is rendered on a non-Google map.

### Task 6.2: Photo spot & lighting engine

**Files:** create `services/optimizer/app/solvers/sun.py`, `services/optimizer/tests/test_sun.py`, `lib/photo/spots.ts`, `app/api/trips/[tripId]/photo-spots/route.ts`, `features/workspace/photo-card.tsx`, `tests/photo/*.test.ts`.

- [ ] `/solve/sun`: SunCalc azimuth and elevation for coordinates plus date, returning golden-hour and blue-hour windows.
- [ ] "Golden Footprints": exact stand-here coordinates per spot, with focal-length and framing guide text.
- [ ] The scheduler prefers placing photo spots inside their golden or blue window whenever the DAG has slack.
- [ ] Tests: a known latitude/longitude/date matches reference sun angles, a spot is scheduled into its window when slack exists, guide text is always present.

### Task 6.3: Context-aware packing checklist

**Files:** create `supabase/migrations/2026090X0004_packing_items.sql`, `lib/packing/generate.ts`, `lib/weather/forecast.ts`, `lib/offline/allergy-card-cache.ts`, `app/api/trips/[tripId]/packing/route.ts`, `features/workspace/packing-list.tsx`, `tests/packing/*.test.ts`.

- [ ] Pull hourly forecast and UV index (OpenWeatherMap) for the trip dates; add rain gear and sun-protection items with a `weather` reason.
- [ ] Add dress-code items with a `dress_code` reason for every planned POI that requires modest attire.
- [ ] Generate a bilingual (English + Malay for the reference region) emergency allergy card from confirmed allergen flags, downloadable and offline-capable.
- [ ] The generated allergy card is cached client-side (service worker precache plus a `localStorage` fallback) the moment it is generated, so it renders instantly in airplane mode rather than depending on a live fetch — this is the one artifact in the product that must never wait on a network round trip.
- [ ] Shared-item claims so one power bank is not packed four times.
- [ ] Tests: forecast rain adds an umbrella, a mosque in the plan adds a dress-code item, the allergy card reflects confirmed flags only, a claim assigns exactly one owner, the card still renders from cache with the network mocked offline.

**Phase 6 exit criteria:** the workspace shows a 3D navigation view with a grounded orientation cue that never names a landmark outside the deterministic candidate list; a photo spot lists a golden-hour window and a stand-here point; the packing list reflects the real forecast, a dress-code POI, and Ben's allergy card, which still renders with the network disabled.

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
- [ ] **Budget-recovery pass:** the payload carries `accumulated_cost` (from the Task 2.4 ledger) and `remaining_budget_cap`. When `remaining_budget_cap < planned_cost` for the unvisited tail of the DAG, the solver does not just drop the lowest-utility paid item — it runs a substitution pass over the remaining Knapsack candidates, preferring a high-utility `cost_tier = 'free'` alternative from `poi_catalog` (public skywalks, open-air heritage quarters, and similarly tagged free POIs) over simply removing a node, so the day stays full rather than just cheaper. The consensus anchor and any `locked` node are never touched by this pass.
- [ ] Every swapped-in node passes the [gate](#vii-hard-constraint-gate).
- [ ] Document and measure a latency budget for a single-day DAG; assert it in tests.
- [ ] Tests: rain swaps the photo leg to the arcade while keeping the anchor arrival, a budget-overrun trigger prefers a free-tier substitution over deletion when one gate-passes, deletion remains the fallback when no adequate free substitute exists, locked nodes never move.

### Task 7.3: Confirmation-first healed plan

**Files:** create `lib/heal/apply.ts`, `features/workspace/heal-banner.tsx`, `tests/heal/apply.test.ts`.

- [ ] Push the diff to every connected member over the trip channel as a workspace banner plus a chat proposal card, using the Task 3.5 confirmation primitive and showing what changes and why.
- [ ] The current active itinerary stays active until an authorized member confirms. On reject, log and keep the original.
- [ ] `heal_events` records the trigger, the diff, and the outcome.
- [ ] Tests: an unconfirmed heal does not mutate the active plan, confirmation applies atomically, rejection is logged.

**Phase 7 exit criteria:** an 85%-precipitation trigger on the reference trip produces a confirmable diff that swaps the outdoor photo leg for a sheltered arcade, rebalances the budget, keeps the 18:00 anchor, and changes nothing until confirmed; a simulated overspend against `remaining_budget_cap` produces a diff that substitutes a free-tier POI ahead of the anchor rather than just deleting a node.

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

- [ ] Document configuration by exposure class: public `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and referrer-restricted `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`; server-only `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPT_SERVICE_TOKEN`, `GOOGLE_MAPS_SERVER_KEY`, `OPENWEATHER_KEY`, and `REDIS_URL`. No server secret gets a `NEXT_PUBLIC_` prefix. Configure API allowlists, referrer/IP restrictions, billing budgets, quota caps, and alerts.
- [ ] The optimizer service is network-isolated and reachable only from the Next.js service.
- [ ] Health endpoints for both services; structured logs with no prompt payloads, no secrets, and no raw personal data.
- [ ] Configure the Supabase Realtime quotas and allowed origins; run a production smoke test with non-sensitive demo data and two concurrent sessions.
- [ ] CI runs the full [verification standard](#verification-standard) for both services on every pull request.

### Task 9.3: Demo

**Files:** `docs/demo-walkthrough.md`.

- [ ] A scripted sub-three-minute run of the reference trip that hits constraint safety, split/merge math, self-healing, and on-site VQA.

**Phase 9 exit criteria:** the team can demonstrate the ingest → optimize → split → heal → merge → VQA → ledger path end to end in under three minutes, with both services deployed and CI green.

---

## Phase 10 — Post-web Android companion

**Start condition:** Phase 9 is green in production-like web testing, API contracts have remained
stable for one release cycle, and user research shows meaningful demand for on-trip native
capabilities. This phase is a follow-on product decision, not part of the web MVP critical path.
Native Kotlin with Jetpack Compose is the default because offline state, camera capture,
notifications, and controlled location sharing are central to the companion. Record an ADR before
starting if evidence favors Flutter, React Native, or Kotlin Multiplatform instead.

### Task 10.1: Mobile API contract hardening

**Files:** create `contracts/openapi.yaml`, `contracts/fixtures/`, `docs/mobile-api.md`; modify shared
web route tests and CI contract checks.

- [ ] Inventory every companion operation: sign-in/session refresh, active itinerary snapshot,
      chat history/send, proposal decision, constraint read, split/merge status, allergy-card
      download, receipt upload, and food-VQA upload.
- [ ] Expose each operation through versioned HTTPS/JSON; remove any dependency on calling a
      Next.js server action from outside the web client.
- [ ] Require idempotency keys on retryable mutations and expected revisions on itinerary or trip
      state changes. Preserve the existing server-side authorization and confirmation rules.
- [ ] Generate or validate TypeScript and Kotlin models from the same contract source. Cross-client
      fixture tests must agree on nullable fields, enums, timestamps, bigint revisions, and stable
      error codes.
- [ ] Document Supabase Auth token exchange/refresh, Realtime topics, reconnect/backfill behavior,
      pagination, upload limits, and API version support policy.

### Task 10.2: Android foundation and offline architecture

**Files:** create `android/` with Gradle convention plugins and modules `app`, `core`, `domain`,
`data`, `presentation`, `design-system`, and feature modules for `auth`, `itinerary`, and `chat`.

- [ ] Native Kotlin/Jetpack Compose app with unidirectional state flow, coroutines/Flow, Hilt, and
      repository interfaces defined in the pure Kotlin `domain` layer.
- [ ] Enforce dependency direction: presentation → domain; data → domain; domain has no Android,
      network, database, or UI dependency. DTOs and Room entities never leak into Compose screens.
- [ ] Supabase-compatible authentication with secure token storage and logout cleanup. Never store
      service-role, Gemini, optimizer, or unrestricted provider credentials in the application.
- [ ] Room-backed active-trip snapshot with remote/local data sources and an explicit stale/offline
      UI state. Repository synchronization must preserve the last trusted server revision.
- [ ] CI runs Android lint, unit tests, contract-fixture tests, and a minimal Compose UI smoke test.

### Task 10.3: Android companion MVP

**Files:** create Android feature modules/screens for active trip, itinerary, chat, split status, and
offline safety card.

- [ ] Sign in, select the active trip, view the current itinerary, and receive Realtime updates with
      reconnect/backfill behavior equivalent to web.
- [ ] Read and send trip chat messages, address the assistant, and render pending proposal cards.
      All state-changing decisions still use server-issued confirmation and authorization.
- [ ] Show current split/merge branch, rendezvous anchor, checkpoint time, mission metadata, and
      deterministic ETA guidance. Do not activate or reassign a member silently.
- [ ] Pre-cache the active itinerary and bilingual emergency allergy card for airplane-mode access.
      Offline content clearly displays its last-synced time and never claims a queued change is active.
- [ ] Accessibility, process-death restoration, rotation, offline/reconnect, and expired-session tests.

### Task 10.4: Native on-trip capabilities

**Files:** add Android feature modules for capture, notifications, and split-session location.

- [ ] Camera capture for receipt OCR and food VQA uploads, including client-side EXIF removal,
      compression limits, preview, explicit upload confirmation, and safe failure posture.
- [ ] Push notifications for confirmed itinerary changes, imminent rendezvous, and required user
      action. Notifications contain no sensitive constraint or medical detail on the lock screen.
- [ ] Location sharing is opt-in and active only during a split session, with visible foreground
      state, least-precise sufficient location, short server TTL, and immediate stop on opt-out,
      merge completion, logout, or trip end.
- [ ] Battery, permission denial, revoked permission, background restriction, duplicate upload,
      notification-deep-link, and location-expiry tests.

### Task 10.5: Android planning parity decision

**Files:** create `docs/adr/android-planning-parity.md` after companion telemetry and interviews.

- [ ] Decide from evidence whether Android needs full trip creation, questionnaire editing, jigsaw
      planning, and native Google Maps SDK 3D/map parity. These are not assumed requirements of the companion MVP.
- [ ] If approved, plan them as separately scoped work using the existing versioned contracts and
      server-authoritative rules; do not duplicate optimizer, LLM, or safety logic on-device.

**Phase 10 exit criteria:** an authenticated Android user can open a previously created trip, read
the active itinerary and allergy card offline, reconnect without losing chat, view split/merge
status, and submit confirmed camera uploads. Contract fixtures match the web client, no restricted
secret is packaged, queued offline actions are never shown as active before server acknowledgement,
and location data expires when the split session ends.

---

## IX. Data privacy & safety appendix

This system deliberately handles data the earlier plan avoided: dietary, religious-access, mobility, interest profiles, and live location. These handling requirements are binding.

**Data minimization and scope**

- Collect only what a module needs. Dietary, religious-access, and mobility constraints are stored as **typed enum flags**, never free-text medical histories. No diagnoses, no medication lists, and no disability categories beyond a coarse mobility threshold the traveler sets themselves.
- The Python optimization service receives **anonymized** payloads only: opaque traveler handles and enum flags. It never sees names, contact details, message content, or images.
- Social-media ingestion stores **derived interest tags only**, never raw third-party post content, and only from public or oEmbed surfaces.

**Consent and control**

- A constraint is inert until an authorized member confirms it (Task 1.3). `severe` flags require the affected member's confirmation, or the owner acting on their behalf with the actor recorded.
- Chat inference may create an expiring discovery signal or a constraint-review candidate, but it may never overwrite an explicit survey answer, promote a candidate to a hard constraint, or infer a medical diagnosis.
- Each member can view and delete their own `traveler_profile`, constraints, interest vector, and inferred discovery signals. Deletion or dismissal removes them from future optimization; `heal_events` and `serendipity_log` retain only anonymized references.
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
- Native mobile delivery during Phases 0–9. Phase 10 is a conditional post-web companion and must
  not delay completion of the web lifecycle. Full Android planning/map parity requires Task 10.5's
  evidence-based decision.
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
