# Gemini-Driven Travel Planner Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Keep TDD, review gates, and verification evidence with every task.

## What this does

This project helps solo travelers and groups turn scattered trip ideas into one approved itinerary. The web app captures the trip basics, Gemini drafts a practical plan, the backend validates every suggestion before it becomes official, and Telegram keeps the group coordinated during the trip without forcing everyone into a new app.

**Goal:** Deliver a group trip planner where a focused web app captures trip-level inputs, Gemini generates structured itinerary proposals, deterministic backend rules validate them, and Telegram coordinates the approved trip.

**Architecture:** Next.js owns the web UI, server routes, and Telegram webhook. Supabase owns authenticated trip data and RLS. Gemini is a server-only proposal provider; it returns typed JSON, while backend validation remains responsible for dates, budget, authorization, and every state change.

**Tech stack:** Next.js App Router, React, TypeScript, Supabase Auth/Postgres/RLS, `@google/genai`, Zod, Vitest, GitHub Actions, Telegram Bot API.

**Specification:** `docs/README.md`, `docs/framework.md`, `docs/features/telegram-bot.md`, and `docs/features/privacy-safety.md` remain binding unless this plan explicitly narrows their scope.

## Table of contents

- [What this does](#what-this-does)
- [Target users](#target-users)
- [Why now](#why-now)
- [Before and after impact story](#before-and-after-impact-story)
- [Differentiation](#differentiation)
- [Idea evolution](#idea-evolution)
- [Scope lock](#scope-lock)
- [Gemini safety contract](#gemini-safety-contract)
- [Product flow](#product-flow)
- [User journey map](#user-journey-map)
- [System architecture diagram](#system-architecture-diagram)
- [Concept mindmap](#concept-mindmap)
- [Wireframes](#wireframes)
- [Implementation phases](#phase-0--narrow-the-prototype-and-establish-persistence)
- [Explicit non-goals](#explicit-non-goals)
- [Verification standard](#verification-standard)

## Target users

### Persona 1: Group trip planner

**Name:** Amira, 24, university society committee member

**Trip type:** 6 friends visiting Bangkok for 4 days

**Pain:** Everyone drops ideas in chat, but nobody knows which plan is final. The planner gets stuck reconciling budget, timing, and last-minute changes.

**Quote:** "I do not need a booking super-app. I need one plan everyone can agree on and check quickly."

### Persona 2: Solo traveler who coordinates with others sometimes

**Name:** Daniel, 28, remote worker

**Trip type:** Solo weekend in Penang, meeting friends for selected meals and activities

**Pain:** He wants AI help planning the day, but does not want the AI to silently change confirmed plans or expose private notes to a group chat.

**Quote:** "Suggest options, but let me approve what becomes real."

## Why now

Large language models can now create useful first-draft itineraries from natural trip preferences, but travel still breaks down at the coordination layer: group chat, shared notes, budget discussions, and mid-trip changes live in separate tools. This MVP uses AI only where it is strong, drafting structured options, and keeps correctness, permissions, confirmation, and money arithmetic in deterministic application code.

## Before and after impact story

**Before:** A group plans in Telegram, saves places in Google Maps, tracks costs in a spreadsheet, asks one person to summarize the plan, and loses clarity when someone wants to split off for a different activity. The itinerary becomes a moving target, and nobody is sure whether the latest chat message is a suggestion or the final decision.

**With this solution:** The planner creates one trip, generates a structured proposal, reviews it, and activates it. Telegram becomes the coordination layer for reading the plan, confirming changes, splitting into subgroups, merging back, and logging shared expenses. The AI drafts; the app decides what is valid; the group explicitly confirms what changes.

## Differentiation

The defining twist is the **AI proposes, backend approves** contract. Gemini can produce itinerary candidates and explanations, but it cannot activate a plan, spend money, assign people, bypass permissions, or mutate state. That makes the product different from pure AI chat planners: it combines flexible generation with deterministic safety rails.

| Existing approach | Strength | Gap this plan addresses |
|-------------------|----------|--------------------------|
| TripIt-style itinerary organizer | Good for storing bookings and reservations | Weak at group preference coordination before bookings exist |
| Wanderlog-style collaborative planning | Good shared trip boards and itinerary editing | Still requires users to manage agreement and mid-trip chat decisions manually |
| Google Maps lists or shared docs | Familiar and flexible | No approval workflow, no validated AI proposal, no group expense or split/merge state |
| Pure AI travel chatbot | Fast first draft | Risky as source of truth unless output is validated and confirmed |

## Idea evolution

| Iteration | Direction considered | Decision | Reasoning |
|-----------|----------------------|----------|-----------|
| 1 | Broad travel super-app with maps, weather, booking, price tracking, profile constraints, and provider dashboards | Rejected | Too large for the available prototype window and diluted the core group-coordination problem |
| 2 | Profile-heavy planner with sensitive per-member constraints | Narrowed | Medical, severe allergy, disability, and religious-profile handling requires a higher privacy and safety bar than this MVP should claim |
| 3 | Chat-first autonomous planning bot | Rejected | Direct chat mutation would make state ambiguous and harder to audit |
| 4 | Focused web setup plus Telegram coordination | Accepted | Keeps the web app simple, uses Telegram where groups already coordinate, and makes confirmation explicit |

## Scope lock

The following website features are deliberately **aborted**. Do not build, extend, demo, or describe them as active functionality:

- Per-member profile editor and website consent-control interface.
- MBTI-style travel discovery quiz.
- Niche-place discovery feed and destination-comparison interface.
- Dedicated website weather and Plan B explanation/approval screen.
- Provider-health or provider-status page.

The existing local prototype contains People and provider-status demonstration UI from an earlier direction. It is not part of this plan's target experience and must be removed from the visible MVP in Phase 0.

Trip-level inputs that remain in scope are destination, dates, budget tier, travel load/pace, group notes, and optional ordinary group preferences. Do not collect or persist medical, disability, severe-allergy, or individual religious-profile data in this narrowed MVP. Telegram may collect ordinary trip preferences only after explicit confirmation.

## Gemini safety contract

- Store `GEMINI_API_KEY` only in server-side environment configuration. Never use `NEXT_PUBLIC_GEMINI_API_KEY`.
- Configure `GEMINI_MODEL` server-side; default to a stable Flash model available to the project, initially `gemini-3.7-flash`.
- Use the official `@google/genai` SDK and structured JSON output, then validate the received JSON with Zod.
- Send Gemini the minimum necessary trip-level input. Do not send raw Telegram history or sensitive personal data.
- Gemini proposes activities, ordering, explanations, and alternatives. It cannot mutate Supabase data, bypass RLS, finalize bookings, spend money, or activate a trip plan.
- Backend validation must approve every generated item before it is saved or displayed as approved.
- Gemini API failures, invalid JSON, schema mismatch, timeouts, and rate limits must leave the current approved itinerary unchanged.

## Product flow

```text
Website: destination + dates + budget + pace
                    │
                    ▼
          authenticated server route
                    │
                    ▼
          Gemini structured proposal
                    │
                    ▼
       Zod + deterministic validation
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   pending proposal      validation errors
          │
          ▼
website review or Telegram inline confirmation
          │
          ▼
Supabase transaction activates itinerary
```

## User journey map

| Stage | User action | System response | Success signal |
|-------|-------------|-----------------|----------------|
| Discover | Planner opens the web app | Shows focused setup form for destination, dates, budget, pace, and notes | Planner knows what input is required |
| Generate | Planner requests a plan | Server sends trip-level context to Gemini and validates the structured response | Pending proposal appears with assumptions and explanations |
| Decide | Planner reviews proposal | Web app allows confirm or reject; Telegram can show confirmation prompts later | Approved itinerary becomes the active plan only after confirmation |
| Coordinate | Group members use Telegram | Bot answers `/plan`, `/route`, and `/status` from persisted trip data | Members see the same source of truth |
| Adapt | Group splits or merges mid-trip | Bot creates confirmation-first split/merge flows with deterministic ETA guidance | The group can separate and regroup without losing the plan |
| Close | Group logs expense and requests offline summary | Ledger records confirmed expense; offline summary exports itinerary | Group has cost clarity and a lightweight backup |

## System architecture diagram

```text
┌─────────────────────┐       ┌────────────────────────┐
│ Next.js web app      │       │ Telegram chat           │
│ Trip setup/review    │       │ /plan /route /status    │
└──────────┬──────────┘       └───────────┬────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────────────────────────────────────┐
│ Next.js server routes and actions                    │
│ Auth, proposal generation, confirmation, webhook     │
└──────────┬───────────────────────┬───────────────────┘
           │                       │
           ▼                       ▼
┌─────────────────────┐       ┌────────────────────────┐
│ Gemini provider      │       │ Supabase               │
│ Structured JSON only │       │ Postgres, Auth, RLS     │
└─────────────────────┘       └────────────────────────┘

Control boundary:
Gemini drafts proposals. Server validation and Supabase policies decide what is saved, visible, and active.
```

## Concept mindmap

```text
Travel coordination MVP
├─ Web setup
│  ├─ Destination
│  ├─ Dates
│  ├─ Budget tier
│  ├─ Pace
│  └─ Group notes
├─ AI proposal
│  ├─ Gemini structured output
│  ├─ Assumptions
│  ├─ Activity rationale
│  └─ Contingency notes
├─ Safety contract
│  ├─ Server-only API key
│  ├─ Zod schemas
│  ├─ Deterministic validation
│  ├─ Pending state
│  └─ Explicit confirmation
├─ Telegram coordination
│  ├─ Read-only commands
│  ├─ Preference confirmation
│  ├─ Split flow
│  └─ Merge flow
└─ Trip utilities
   ├─ Shared expense ledger
   └─ Offline summary
```

## Wireframes

These wireframes define the MVP design target. Final visual styling should follow the existing app structure in `components/trip-setup-dashboard.tsx` and `app/globals.css`: calm dashboard layout, compact controls, clear state labels, and no profile/provider/weather surfaces.

Frontend design must not use emoji as interface decoration, status markers, icons, or visual emphasis. Use text labels, layout, color, and proper icon components instead.

### 1. Trip setup screen

```text
┌────────────────────────────────────────────────────────────┐
│ Trip setup                                                  │
│ One focused form for the shared trip.                       │
├──────────────────────────────┬─────────────────────────────┤
│ Destination                  │ Dates                       │
│ [ Bangkok               ]    │ [ Sep 12 ] to [ Sep 15 ]    │
│                              │                             │
│ Budget tier                  │ Pace                        │
│ [ Value ▼ ]                  │ [ Relaxed | Balanced | Full ]│
│                              │                             │
│ Group notes                                                │
│ [ food markets, temples, low walking on day one        ]   │
│                                                            │
│ [ Generate plan ]                                          │
└──────────────────────────────┴─────────────────────────────┘
```

### 2. Proposal generation loading state

```text
┌────────────────────────────────────────────────────────────┐
│ Creating proposal                                           │
├────────────────────────────────────────────────────────────┤
│ Validating trip dates                                       │
│ Sending trip-level context to Gemini                        │
│ Checking returned schedule, budget, and schema              │
│                                                            │
│ [ progress indicator ]                                     │
└────────────────────────────────────────────────────────────┘
```

### 3. Proposal review screen

```text
┌────────────────────────────────────────────────────────────┐
│ Pending itinerary proposal                                  │
│ Gemini suggested this plan. It is not active yet.           │
├──────────────────────┬─────────────────────────────────────┤
│ Day 1                │ Summary                             │
│ 09:30 Temple visit   │ Balanced culture and food route      │
│ 12:00 Lunch market   │                                     │
│ 15:00 Riverside walk │ Assumptions                          │
│                      │ - Uses value budget tier             │
│                      │ - Keeps walking moderate             │
│                      │                                     │
│                      │ [ Confirm itinerary ] [ Reject ]     │
└──────────────────────┴─────────────────────────────────────┘
```

### 4. Telegram chat interaction

```text
Group chat
──────────────────────────────────────────────────────────────
User: /status
Bot: Bangkok trip, Sep 12-15. Active itinerary confirmed.
     Next: Temple visit at 09:30. Pending proposals: none.

User: prefer more food stops
Bot: Add "more food stops" as an ordinary group preference?
     [ Confirm ] [ Ignore ]
```

### 5. Split and merge flow

```text
Group chat
──────────────────────────────────────────────────────────────
User: /split Market team: Ana, Jo | Museum team: Lee, Sam
Bot: Create two subgroups with Central Pier as rendezvous?
     [ Confirm split ] [ Cancel ]

User: /merge Market team ETA 25
Bot: ETA difference is 25 minutes.
     Suggested action: choose a low-commitment nearby pause.
     [ Mark merged ] [ Keep split active ]
```

### 6. Offline summary

```text
┌────────────────────────────────────────────────────────────┐
│ Offline trip summary                                        │
├────────────────────────────────────────────────────────────┤
│ Bangkok, Sep 12-15                                          │
│ Day-by-day active itinerary                                 │
│ Rendezvous instructions                                     │
│ Confirmed subgroup notes                                    │
│ Expense balance summary                                     │
│                                                            │
│ [ Download HTML ]                                           │
└────────────────────────────────────────────────────────────┘
```

## Phase 0 — Narrow the prototype and establish persistence

**Implementation status (2026-09-03):** Phase 0 and 1 application code is implemented on `codex/phase-0-1`. Local unit, component, API, PostgreSQL, browser, and production-build checks are recorded in `docs/testing/phase-0-1.md`. Hosted Supabase migration/authentication checks and a real Gemini request remain pending configuration. Neither phase's live exit gate is marked complete. The separate proposed commits below are consolidated into `feat: implement authenticated trip planning and Gemini proposals` at the user's request.

**Contract clarifications:** Each activity includes a `date` for multi-day validation. Trips cover 1-14 days. Owners/planners may edit and generate; only the owner may confirm/reject. Confirmation revalidates the proposal against the current trip revision in a database transaction.

### Task 0.1: Remove aborted prototype surfaces

**Files:** Modify `components/trip-setup-dashboard.tsx`, `features/planning/demo-data.ts`, `app/globals.css`, and related tests.

**Deliverable:** The visible web app contains Trip Setup and Plan views only. It does not show People, consent toggles, provider health, profile-specific copy, or weather/Plan B controls.

- [x] Write a failing state/component test confirming only setup and proposal actions are rendered.
- [x] Remove the People tab, consent mutation handlers, provider-health block, and profile-specific demo data.
- [x] Replace profile-driven candidates with non-sensitive trip-level sample activities.
- [x] Remove profile-specific tests; retain date, budget, pace, schedule, and proposal authorization tests.
- [x] Run `npm run lint`, `npm test`, and `npm run build`.
- [ ] Commit: `refactor: narrow trip planner MVP scope`.

### Task 0.2: Connect Supabase and apply migrations

**Files:** Modify `.env.example`; create `lib/supabase/server.ts`, `supabase/migrations/202609030004_narrow_trip_scope.sql`, `tests/database/live-rls.md`, and a migration contract test.

**Deliverable:** A development Supabase project has authenticated trip storage limited to trips, members, itinerary days/items, proposals, and ordinary trip preferences.

- [x] Add server-only `GEMINI_API_KEY` and `GEMINI_MODEL` placeholders to `.env.example`.
- [x] Add a forward-only migration that prevents the narrowed application from exposing unused sensitive profile data. Do not rewrite committed migrations.
- [ ] Apply all migrations to a disposable development Supabase project.
- [ ] Verify owner, planner, member, and unrelated-user access manually; record commands and results without secrets.
- [x] Add a migration contract test for the new migration, extended with executable PostgreSQL permission and transaction tests.
- [ ] Commit: `feat: connect narrowed trip schema to Supabase`.

### Task 0.3: Add authentication and authenticated trip repository

**Files:** Create `middleware.ts`, `app/login/page.tsx`, `app/auth/callback/route.ts`, `lib/repositories/supabase-trip-repository.ts`, and `tests/repositories/supabase-trip-repository.test.ts`. Modify `lib/repositories/planning-repository.ts` and `components/trip-setup-dashboard.tsx`.

**Interface:**

```ts
type TripInput = {
  destinationName: string;
  startDate: string;
  endDate: string;
  budgetTier: BudgetTier;
  pace: PaceLevel;
  notes?: string;
};

interface TripRepository {
  createTrip(input: TripInput): Promise<TripRecord>;
  getTrip(tripId: string): Promise<TripRecord>;
  updateTrip(tripId: string, input: TripInput): Promise<TripRecord>;
}
```

- [x] Write failing tests for authenticated creation, loading, updating, and cross-trip denial.
- [x] Implement Supabase SSR sessions and protected routes.
- [x] Implement the repository with server-side Supabase clients and RLS-protected tables.
- [x] Replace `LocalPlanningRepository` as the default application storage.
- [ ] Run hosted repository integration tests. Local repository/Auth-adapter tests, PostgreSQL tests, `npm test`, and `npm run build` pass; hosted verification still requires a disposable project.
- [ ] Commit: `feat: persist authenticated trips in Supabase`.

**Phase 0 exit criteria:** An authenticated owner can create and reload a trip, an unrelated account cannot read or update it, and none of the five aborted surfaces appear in the web app.

## Phase 1 — Gemini itinerary proposal engine

### Task 1.1: Define the structured proposal contract

**Files:** Create `lib/gemini/schemas.ts`, `lib/gemini/types.ts`, and `tests/gemini/schemas.test.ts`.

**Interfaces:**

```ts
type GeminiTripRequest = {
  destinationName: string;
  startDate: string;
  endDate: string;
  budgetTier: BudgetTier;
  pace: PaceLevel;
  notes?: string;
};

type GeminiActivity = {
  title: string;
  category: "culture" | "food" | "nature" | "shopping" | "transit";
  date: string;
  startTime: string;
  durationMinutes: number;
  estimatedCostTier: BudgetTier;
  rationale: string;
  contingencyNote: string | null;
};

type GeminiTripProposal = {
  summary: string;
  activities: GeminiActivity[];
  assumptions: string[];
};
```

- [x] Define Zod request and response schemas.
- [x] Add tests rejecting malformed times, unsupported categories, invalid tiers, and missing rationale.
- [x] Add a pure mapper from Gemini output to internal itinerary candidates.
- [ ] Commit: `feat: define Gemini trip proposal contract`.

### Task 1.2: Implement the server-only Gemini adapter

**Files:** Create `lib/gemini/client.ts`, `lib/gemini/trip-planner.ts`, and `tests/gemini/trip-planner.test.ts`. Modify `package.json` and `.env.example`.

- [x] Add `@google/genai` and `zod`.
- [x] Write fake-client tests for valid JSON, invalid JSON, schema mismatch, provider failure, and timeout behavior.
- [x] Build a prompt that requests only candidate itinerary suggestions and forbids factual guarantees, booking, or state mutation.
- [x] Configure Gemini structured JSON output with the proposal schema.
- [x] Parse returned JSON through Zod and map errors to a stable `GeminiPlanningError`.
- [ ] Commit: `feat: add structured Gemini trip planner`.

### Task 1.3: Validate and persist pending proposals

**Files:** Create `lib/domain/gemini-proposal-validation.ts`, `app/api/trips/[tripId]/proposals/route.ts`, `app/actions/proposals.ts`, `tests/domain/gemini-proposal-validation.test.ts`, and `tests/api/trip-proposals.test.ts`.

- [x] Write failing tests for invalid date range, time, duration, budget mismatch, and unauthorized actor.
- [x] Validate output with strict date and schedule helpers before persistence.
- [x] Store proposal JSON, validation outcome, generated timestamp, model identifier, and expiry in `agent_proposals`.
- [x] Return only a pending proposal or clear validation errors; never activate an itinerary from generation.
- [x] Add per-user and per-trip rate limiting.
- [ ] Commit: `feat: persist validated Gemini trip proposals`.

### Task 1.4: Build the focused proposal-review UI

**Files:** Modify `components/trip-setup-dashboard.tsx` and `app/globals.css`. Create `components/gemini-proposal-review.tsx` and `tests/components/gemini-proposal-review.test.tsx`.

- [x] Write UI tests for loading, successful proposal, Gemini failure, validation error, and owner-only confirmation.
- [x] Add a Generate Plan action that calls the authenticated proposal route.
- [x] Display summary, activities, rationale, assumptions, and contingency notes as pending proposal content.
- [x] Keep the five aborted website surfaces absent.
- [x] Run lint, test, coverage, and production build.
- [ ] Commit: `feat: review Gemini trip proposals on web`.

**Phase 1 exit criteria:** An authenticated owner can submit trip-level inputs, receive a schema-valid Gemini proposal, inspect its assumptions, and confirm or reject it without Gemini directly changing itinerary state.

## Phase 2 — Telegram trip coordinator

### Task 2.1: Link Telegram users to trips

**Files:** Create `lib/telegram/link-tokens.ts`, `app/api/telegram/webhook/route.ts`, `tests/telegram/link-tokens.test.ts`, and `tests/api/telegram-webhook.test.ts`.

- [ ] Add hashed, expiring, single-use link tokens in Supabase.
- [ ] Test expiration, replay, wrong-trip access, and successful linking.
- [ ] Verify incoming requests with `TELEGRAM_WEBHOOK_SECRET`.
- [ ] Persist only Telegram identifier and confirmed trip relationship.
- [ ] Commit: `feat: link Telegram users to trips`.

### Task 2.2: Implement read-only commands

**Files:** Create `lib/telegram/commands.ts`, `lib/telegram/messages.ts`, and `tests/telegram/commands.test.ts`.

```text
/plan   — active itinerary
/route  — next activity and timing
/status — trip summary and pending proposal state
```

- [ ] Write tests for linked, unlinked, and unauthorized users.
- [ ] Implement the three commands from persisted data.
- [ ] Ensure bot messages never expose another trip's data.
- [ ] Commit: `feat: add Telegram trip status commands`.

### Task 2.3: Add confirmation-first coordination

**Files:** Create `lib/telegram/callbacks.ts`, `lib/telegram/preference-proposals.ts`, and `tests/telegram/callbacks.test.ts`.

- [ ] Limit Telegram preferences to ordinary interests, pace, and budget sentiment.
- [ ] Test callback replay, expiry, authorization, approval, and rejection.
- [ ] Use inline confirmation for every proposed change.
- [ ] Route approval through the same backend proposal-confirmation action as the web app.
- [ ] Commit: `feat: add confirmed Telegram coordination`.

**Phase 2 exit criteria:** Linked Telegram users can read the active plan and confirm ordinary trip decisions without direct database access.

## Phase 3 — Group split and merge

### Task 3.1: Persist subgroup sessions

**Files:** Create `supabase/migrations/202609030005_subgroup_sessions.sql`, `lib/domain/subgroups.ts`, and `tests/domain/subgroups.test.ts`.

- [ ] Add `subgroups`, `subgroup_members`, and `split_sessions` with trip-scoped RLS.
- [ ] Test duplicate members, missing rendezvous data, non-member assignment, and unauthorized split creation.
- [ ] Implement deterministic split validation. Gemini may suggest branches but cannot assign members.
- [ ] Commit: `feat: persist secure subgroup sessions`.

### Task 3.2: Add `/split` and `/merge`

**Files:** Modify `lib/telegram/commands.ts`. Create `lib/domain/merge-recommendation.ts`, `tests/domain/merge-recommendation.test.ts`, and `tests/telegram/split-merge.test.ts`.

```text
0–20 minutes: wait at the named rendezvous anchor
21–60 minutes: suggest a low-commitment nearby pause
61+ minutes: continue to the next fixed commitment
```

- [ ] Write tests for the three ETA ranges and unauthorized actions.
- [ ] Add inline confirmation for split assignment and merge completion.
- [ ] Keep routes text-based; maps and live tracking are out of scope.
- [ ] Commit: `feat: coordinate Telegram subgroup splits`.

**Phase 3 exit criteria:** A group can make one confirmed split and merge through Telegram with a named rendezvous and deterministic ETA guidance.

## Phase 4 — Expense ledger and offline summary

### Task 4.1: Implement a minimal shared expense ledger

**Files:** Create `supabase/migrations/202609030006_expense_ledger.sql`, `lib/domain/ledger.ts`, and `tests/domain/ledger.test.ts`. Modify `lib/telegram/commands.ts`.

- [ ] Add expenses and expense-share records with RLS.
- [ ] Test equal split rounding, subgroup-only costs, duplicate callbacks, and unauthorized expense creation.
- [ ] Implement deterministic balance calculation. Do not use Gemini for money arithmetic.
- [ ] Add owner-confirmed `/expense <amount> <description>`.
- [ ] Commit: `feat: add confirmed shared expenses`.

### Task 4.2: Generate an offline trip summary

**Files:** Create `app/api/trips/[tripId]/offline-summary/route.ts`, `lib/export/offline-summary.ts`, and `tests/export/offline-summary.test.ts`. Modify `lib/telegram/commands.ts`.

- [ ] Test authorization and cross-trip data isolation.
- [ ] Generate lightweight HTML first; add PDF only if time remains.
- [ ] Add `/offline` to send the attachment or secure link.
- [ ] Commit: `feat: export offline trip summary`.

**Phase 4 exit criteria:** A group can log one confirmed shared expense and retrieve a compact offline itinerary summary through Telegram.

## Phase 5 — Testing, deployment, and demo

### Task 5.1: End-to-end acceptance path

**Files:** Create `tests/e2e/trip-lifecycle.spec.ts` and `docs/demo-walkthrough.md`.

- [ ] Sign in as owner and create a trip.
- [ ] Generate and confirm a Gemini proposal.
- [ ] Link a Telegram account.
- [ ] Run `/plan` and `/status`.
- [ ] Create one confirmed split and merge.
- [ ] Log one expense and request `/offline`.

### Task 5.2: Deployment readiness

**Files:** Create `Dockerfile`, `.github/workflows/deploy.yml`, and `docs/deployment.md`.

- [ ] Document only server-side Supabase, Gemini, and Telegram variables.
- [ ] Add production webhook configuration, a health endpoint, and structured logs without prompt payloads or secrets.
- [ ] Deploy the Next.js service and configure the Telegram webhook.
- [ ] Run production smoke tests using non-sensitive demo data.

**Phase 5 exit criteria:** The team can demonstrate the authenticated web-to-Gemini-to-Telegram path in under three minutes.

## Explicit non-goals

- Per-member profile editor or website consent controls.
- MBTI/personality quiz.
- Niche discovery feed or destination comparison.
- Dedicated weather/Plan B website UI.
- Provider status dashboard.
- Medical, disability, severe-allergy, or individual religious-profile collection.
- Autonomous booking, rebooking, payments, emergency dispatch, location tracking, or automatic chat-derived mutations.
- Real-time transit routing, flight status, hotel availability, crowd feeds, or price-drop monitoring.

## Verification standard

Every completed task must provide:

```text
npm run lint
npm test
npm run test:coverage
npm run build
git diff --check
```

Tasks that add Supabase or Telegram behavior must also include focused integration tests against a disposable development environment. No phase is complete until its exit criteria and required tests have evidence in the repository.
