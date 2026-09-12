# Prototype mode & the backend logic behind it

The four features below are shipped in this branch as **hardcoded, in-memory demo
screens** so the idea can be shown end to end without a Supabase project, a Gemini
key, a routing provider, or an optimizer. This document explains (a) how prototype
mode is wired and kept safe, and (b) for each feature, what the *real* backend
would do — data model, endpoints, deterministic checks, and provider calls.

Nothing in the real data path was changed. Every prototype screen is reached
through an `isPrototype()` branch at the top of a route file; the Supabase / Gemini
code still runs unchanged when prototype mode is off.

---

## 1. Prototype mode

### Turning it on

`lib/prototype/config.ts`:

```
isPrototype() =
     NEXT_PUBLIC_PROTOTYPE === "1"                       // explicit, works anywhere
  || (NODE_ENV !== "production" && !isSupabaseConfigured())   // dev convenience only
```

- A **production** build with missing/blank Supabase env vars does **not** become
  the prototype — it fails exactly as it does today. This is the guardrail against
  a misconfigured production deploy silently bypassing auth.
- `middleware.ts` bypasses the auth + onboarding gate **only** when `isPrototype()`
  is true. It never keys off the request cookie.
- The `wp_prototype` cookie set by the "Enter demo" button is a UI marker only
  ("a demo session was chosen"). It grants nothing; removing it changes nothing.
- The persistent **"Demo mode — sample data only"** banner (`AppShell`) and the
  inline "won't be saved / resets on refresh" hints make the ephemerality visible,
  especially on the preference-confirm and itinerary-edit actions.

### What it swaps

| Route | Real | Prototype |
| --- | --- | --- |
| `/login` | Supabase magic-link / dev password | a look-alike sign-in form that accepts any email/password (or none) → `/chats` |
| `/chats` | `getChatHome(client)` → RLS query | `DEMO_CHAT_HOME_TRIPS` fixture |
| `/trips/[id]/layout` | membership + trip row check | fixed `DEMO_TRIP` shell |
| `/trips/[id]/chat` | `listMessages` + Realtime channel | `DemoChat` over `DEMO_CHAT_MESSAGES`, local state |
| `/trips/[id]/plan` | `PlanView` → `GET /api/trips/[id]` | `DemoPlan` over `DEMO_PROPOSAL`, local accept/reject |
| `/trips/[id]/timeline` | `TimelinePane` → itinerary + POI APIs | `DemoTimeline`, seeded blocks — local drag-to-move, drag-bottom-edge-to-resize (15-min snap, keyboard too), add/remove |
| `/trips/[id]/map` | *not built* | `DemoMap` (this branch adds the route + nav item) |
| `/trips/[id]/decisions` | *not built* | `DemoDecisions` — signals from chat + saved Timeline changes, Agree/Disagree + 1-5 star rating, local state only |
| `/trips/[id]/entry` | `getMyMemberEntryContext` server action | `DemoMemberEntry` + `DailyRhythm` |
| `/trips/[id]/jigsaw` | *not built* | `JigsawView` — fixture scores through the **real** `evaluateTeam`/`shouldSplitCut` |
| `/trips/[id]/budget` | *not built* | `BudgetView` — fixture expenses through the **real** `simplifyDebts` |
| `/trips/[id]/safety` | *not built* | `SafetyView` — scripted vision result, real fails-closed rule |
| `/trips/[id]/packing` | *not built* | `PackingView` — items derived from the demo weather / dress codes / constraints |
| `/settings` | `UserOnboardingWizard` → `/api/onboarding` | `PreferenceSurvey`, local state |

Demo edits live in React state and are gone on refresh — deliberate, so a live
demo always starts from the same scripted state.

---

## 2. Feature: preference survey & editor

**Prototype** (`components/preference-survey.tsx`): rank six interests, pick a
usual budget / pace / social role / daily walking cap. "Save" flips a local
confirmation. The copy states the rule: this is a **soft** change.

**Real backend**

- **Data model.** A `traveler_preferences` row per user (distinct from the
  safety-only `onboarding_profile` captured at first login — see
  `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md`).
  Fields: `interest_vector` (ordered enum list → weights), `budget_tier`,
  `pace`, `social_role`, `daily_walk_cap_km`, `preferences_revision`,
  `updated_at`. RLS: owner-only read/write.
- **Endpoint.** `PUT /api/preferences` with an `expectedRevision` for optimistic
  concurrency (same stale-write pattern as onboarding: a `409 STALE_PROFILE`
  makes the client refetch and replay). Zod-validated; interest list capped to
  the known vocabulary.
- **How it is used.** The ranked interests become this member's **weight vector**
  in the jigsaw fairness engine (`lib/domain/jigsaw.ts`), which currently runs on
  UI-supplied weights. `paretoFill` / `roundRobinVeto` / minimax-regret scoring
  then reflect what each person actually wants.
- **Soft vs safety.** A write here sets `preferences_revision` and takes effect
  for *future* ranking only. It does **not** touch an active itinerary. Only a
  *stricter* safety requirement (edited from the Travel DNA screen) marks
  affected activities for review — that path already exists in the constraint
  gate. The editor surfaces a "review current itinerary?" action that produces a
  diff rather than rewriting silently.

---

## 3. Feature: chat preference extraction

**Prototype** (`features/prototype/demo-decisions.tsx` + `decision-card.tsx`, fed
by `DemoTripStateProvider`'s `decisions` list): every signal is listed on the
dedicated `/trips/[id]/decisions` page rather than inline in chat — two soft
signals (`live jazz`, `indoor day Saturday`) with an expiry, one
**hard-constraint candidate** (`no shellfish`, addressed to Arun). Agree/Disagree
then a 1-5 star rating replace the old Confirm/Edit/Reject; the same page also
collects one entry per Timeline change saved that session.

**Real backend**

- **Extraction.** On each new message (or on a debounced window), a server job
  sends recent chat context to Gemini with a **strict JSON schema**: an array of
  `{ kind: "soft" | "hard_candidate", label, source_message_id, confidence,
  suggested_expiry, for_member_id? }`. Gemini only *proposes* — it has no
  database tools and cannot write (this is the same trust boundary as the
  itinerary planner: see `docs/agentic-architecture.md`).
- **Soft signals.** Stored in `discovery_signals` (`trip_id`, `label`,
  `created_from_message_id`, `status`, `expires_at`). They are trip-scoped and
  time-boxed. A confirmed signal is added to the candidate-ranking hint for that
  trip (e.g. bias evening slots toward live music); it expires on its own and is
  never written back to `traveler_preferences`. Confirm/Reject is any member;
  `PATCH /api/trips/[id]/signals/[sig]`.
- **Hard-constraint candidates.** Never applied by the model or by another member.
  A row in `constraint_candidates` (`trip_id`, `for_member_id`, `kind`,
  `flag`, `source_message_id`, `status = pending`). It is shown **only to the
  named member** as a Confirm / Edit / Reject card. On **Confirm**
  (`POST /api/trips/[id]/constraints` as that member, RLS-checked so no one can
  confirm for someone else) it becomes a real typed constraint and enters the
  **deterministic hard-constraint gate** (`lib/domain/constraint-gate.ts`):
  every scheduled and proposed food activity is re-evaluated, and anything that
  cannot be verified safe fails closed. Free-text that looks like a medical
  disclosure is rejected — constraints are typed flags, not prose
  (`lib/domain/trip.ts` sensitive-text guard).
- **Privacy.** The candidate and its confirmation are visible to the affected
  member only; the group sees the constraint's *effect* on the plan, not the
  chat line it came from.

---

## 4. Feature: preferred daily start & finish times

**Prototype** (`features/prototype/daily-rhythm.tsx`): each of the three members
has a window; you edit yours with two time inputs; a strip shows all three and
the computed shared band. Overlap = `[max(all starts), min(all ends)]`; if empty
it says a split day would be suggested.

**Real backend**

- **Data model.** Part of the per-trip `member_entry` row (alongside
  availability / budget / pace, `components/member-entry-panel.tsx`):
  `day_start_local` and `day_wind_down_local` as destination-local wall-clock
  times. Per-trip, not a global preference.
- **Endpoint.** The existing `POST /api/trips/[id]/member-entry` gains the two
  fields; Zod-validated (`start < wind_down`, sane bounds).
- **How it is used.** Before itinerary generation the server computes the group
  usable window as the intersection of every member's window (partial-trip
  members only constrain the days they are present). That window is passed to:
  1. the **Gemini planner** as a hard framing ("schedule only between 09:30 and
     21:00");
  2. the **deterministic feasibility check** — an activity placed outside the
     window is rejected the same way an out-of-opening-hours placement is
     (`lib/poi/opening-hours.ts` / `lib/poi/schedule-validation.ts`).
- **No overlap.** If the intersection is empty, the jigsaw split-cut path
  (`shouldSplitCut`) is offered: a morning/evening split that reconverges at a
  shared anchor, rather than forcing an itinerary nobody can fully attend.
- **Timezone.** Times are destination-local wall-clock. Notification features
  (not in scope) need timezone resolution for the destination first.

---

## 5. Feature: live map & travel-time routing

**Prototype** (`features/prototype/demo-map.tsx` → `features/prototype/map/`,
new `/trips/[tripId]/map` route + "Map" sidebar item). A Google-Maps-style
screen, not a document-flow panel:

- **Full-bleed map** fills the content area; everything else floats on top.
- **Floating route card** (origin → destination with a connector rail) + **day
  chips** (Day 1/2/3) top-left.
- **Circular edge controls** (layers, recentre).
- **Draggable bottom sheet** with three snap points (peek / half / full) —
  pointer-drag the grab handle or tap it to cycle; springs to the nearest snap.
  On ≥ 900px it re-docks as a left rail against the map.
- Inside the sheet: **travel-mode tabs** (walk / drive / transit / cycle) with a
  sliding underline; each shows that mode's live duration. A big amber summary
  (`31 min (2.2 km)`), meta chips, the numbered **stop list** with leg
  connectors, a collapsible **turn-by-turn** list, and a CTA row.
- Motion: sheet spring, tab-underline slide, staggered chip / stop / marker
  entrances, animated route draw on the fallback.

With `NEXT_PUBLIC_GOOGLE_MAPS_KEY` set (enable **Maps JavaScript API** +
**Directions API** — both have a free monthly credit; legacy name
`NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` is still accepted):

- `useDirections` (`features/prototype/map/use-directions.ts`) routes the day's
  stops for **all four modes in parallel** (`origin` = stop 1, `destination` =
  last stop, middle stops as `waypoints`; transit drops waypoints since Google
  rejects them) and caches per day. Tabs fill in as each resolves; unsupported
  modes (e.g. cycling in Malaysia → `ZERO_RESULTS`) show `—`.
- `MapLayer` draws a muted custom map style, its own navy numbered teardrop pins
  (dropped in), and a thick route polyline via `DirectionsRenderer`
  (`suppressMarkers`), re-`fitBounds` per day/mode with padding that clears the
  floating chrome (left rail on wide screens, peeking sheet on narrow).
- **2D / 3D toggle** (a FAB): 2D is the flat styled roadmap; 3D swaps to tilted
  (`setTilt(45)`) satellite/aerial imagery (`hybrid`) headed along the route
  (`setHeading` = first→last bearing), Waze-style, with rotate-left / face-north /
  rotate-right controls. Returning to 2D restores the style and re-frames.
- **Street View as wayfinding** (`street-view.tsx`): a `StreetViewPanorama` overlay
  opened from the pegman FAB, the corner preview card, or the per-stop button in
  the sheet. `StreetViewService.getPanorama({ radius: 60 })` finds the nearest
  panorama. The POV opens along the **route's actual set-off bearing**
  (`legHeadings`, derived by `initialHeading()` from the first step's polyline),
  *not* the straight line to the next stop — measured at Street of Harmony those
  differ by **28.7°** (crow-flies 266.5° W vs. walkable street 295.2° WNW, where
  Google itself says "Head northwest on Pesara Claimant"), which is the
  difference between the right alley and a wall. Crucially it is also not a
  static photo: a `pov_changed` listener feeds `relativeBearing(target, heading)`
  so an arrow **stays locked on the route while you look around**,
  with a plain-language cue from `facingCue` — *Straight ahead* (green) /
  *To your left|right* (amber) / *It's behind you — turn around* (red) — plus the
  next stop's name, walk time and distance. That is the difference between "a
  picture of the street" and "which way do I actually walk". A chip row hops
  between the day's stops. Stops Google has not driven (e.g. Clan Jetties, a pier) show a
  clear "no imagery within 60 m" state instead of a blank box. Closing restores
  the map exactly as it was, 3D included. Panoramas ship with the Maps
  JavaScript API — no extra API needed.
- **Corner Street View preview** (`street-thumb.tsx`) uses the **Street View
  Static API** (the one extra API to enable). `return_error_code=true` makes
  Google 404 rather than serve its grey "no imagery" tile, so a missing panorama
  or a disabled API simply hides the card.
- **Navigation mode** (`nav-mode.tsx`, from the sheet's **Start**): a step-through
  turn-by-turn over the live map. Deliberately not GPS-driven — the demo asks for
  no location permission — so the traveller advances each step (buttons or
  ←/→ keys) and `MapLayer`'s `focus` prop pans and zooms the map to that
  manoeuvre. The route card, sheet, thumbnail and FABs slide away; the last step
  turns green with an arrival readout and a Finish button; Escape or Finish
  restores the route screen exactly as it was. Start is disabled when there is no
  live Google route to follow.
- **Turn-by-turn** steps carry a directional glyph per Google `maneuver`
  (`turn-left`/`-right`/`-slight-*`/`-sharp-*`, `roundabout-*`, `uturn-*`,
  `merge`, `fork-*`, …; text fallback when Google gives none), last step = the
  destination pin — see `features/prototype/map/maneuver-icon.tsx`.
- Selecting a mode re-routes; switching the day chip re-routes and re-frames —
  one day at a time, matching the app's "one day at a time" principle.

Without a key (or if it fails), `FallbackMap` renders the stylised numbered-pin
canvas and the mode tabs show rough figures derived from the fixture legs — the
card, sheet, tabs and stop list are all identical, so the screen never looks
broken. A bad/misconfigured key degrades to an inline note.

Setting the key adds Google's map hosts to the CSP (`next.config.ts`) —
`script/img/connect/font-src` gain `*.googleapis.com` / `*.gstatic.com`,
`frame-src` gains `https://www.google.com` — all Google-owned, never a wildcard,
and only when the key is present. The per-leg times in the stop list stay
fixtures (the drawn route does not expose per-leg durations to the client here).

**Real backend**

- **Place identity.** Stops resolve to real coordinates via the two-layer POI
  model already described in the README: the WanderSync-owned catalog first,
  then **Google Places API (New)** for discovery / details / opening hours in
  destinations outside the seeded corridors. Provider results stay visibly
  distinct from owned safety data.
- **Routing.** For each ordered pair of stops on a day, call **Google Routes API**
  (server-only key) for `duration`, `distanceMeters`, and mode
  (`WALK` / `DRIVE` / `TRANSIT`). Cache legs in a `route_legs` table keyed by
  `(from_place_id, to_place_id, mode, date_bucket)` within provider TTL to stay
  inside quota. The browser map uses a separate referrer-restricted key.
- **Travel blocks on the timeline.** Each leg becomes a first-class
  `travel` block between activities (the `travel-block.tsx` component already
  exists). The single-day feasibility checker then counts travel time against
  the day's usable window and the pace cap — so a plan that looks fine by
  activity duration but is impossible once transfers are added is rejected.
- **Adaptive replanning.** Weather-triggered swaps (OpenWeatherMap) and the
  Python optimizer (OR-Tools knapsack + routing for the split-and-merge case)
  consume the same leg matrix. Both are roadmap items; the map view is the first
  surface that needs the routing provider wired.
- **Map tiles / rendering.** Google Maps JavaScript API in the browser. The
  prototype's SVG canvas is a stand-in for that embed; the pin/leg data contract
  (`{ stops: [{id, order, name, time, lat, lng}], legs: [{fromId, toId, mode,
  minutes, distanceKm}] }`) is what the real endpoint would return from
  `GET /api/trips/[id]/route?date=YYYY-MM-DD`.

---

## 6. Showcase features (jigsaw, budget, food check, packing, weather)

Fixtures live in `lib/prototype/demo-features.ts`. Two of these deliberately feed a **real**
domain module rather than pre-computing an answer, so the demo shows what the app would
actually decide:

- **Split & merge** (`/trips/[id]/jigsaw`). The candidate blocks carry per-member 1–10
  satisfaction. `evaluateTeam` computes each member's share of their own best afternoon;
  `shouldSplitCut` decides whether one shared trajectory is defensible. With the shipped
  fixture Arun lands at **0.47** (fair share is `MIN_SATISFACTION_RATIO` 0.7) and the spread is
  **4.03** (threshold 2), so the split is the engine's verdict, not a hardcoded string — a test
  asserts this so a retune can't silently break the premise. Accepting shows the per-branch
  outcome (Arun 7 → 15, nobody worse). *Real backend:* the satisfaction vector comes from the
  preference survey, and accepting writes two branch itineraries plus a merge anchor.
- **Budget ledger** (`/trips/[id]/budget`). `computeBalances` + `simplifyDebts` from
  `lib/domain/debt-simplify` — integer sen, greedy max-debtor matching, at most n−1 transfers.
  *Real backend:* expenses persist per trip; the same pure pass runs server-side.
- **Food check** (`/trips/[id]/safety`). The vision result is scripted (the sample dish is an
  inline SVG — the CSP allows no third-party images). What it demonstrates is the rule: the
  model reports *claims* with confidence, and a confirmed hard constraint turns those claims
  into a refusal. Unknown evidence fails closed. *Real backend:* photo → vision model →
  claims → `lib/domain/constraint-gate`.
- **Packing** (`/trips/[id]/packing`). Every item carries the reason it exists — the forecast,
  a venue dress code, or a confirmed constraint — so the list is auditable.
  *Real backend:* forecast + itinerary venue metadata + confirmed constraints.
- **Weather disruption** (on the Timeline). "Simulate rain" jumps to the affected day, flags the
  outdoor block, and offers an indoor replacement with Accept / Undo.
  *Real backend:* a weather trigger re-runs feasibility and raises the swap as a pending
  proposal for human confirmation — it never rewrites an active itinerary on its own.
- **Rendezvous anchor** on the map: a gold star at the point both split branches rejoin, drawn
  only on the split's day.

## 7. Running the prototype

```
npm run dev:prototype
```

Cross-platform (`scripts/dev-prototype.mjs` sets `NEXT_PUBLIC_PROTOTYPE=1` for the
Next process). Equivalents if you prefer to set the env var yourself:

| Shell | Command |
| --- | --- |
| PowerShell | `$env:NEXT_PUBLIC_PROTOTYPE=1; npm run dev` |
| cmd.exe | `set NEXT_PUBLIC_PROTOTYPE=1 && npm run dev` |
| bash / zsh | `NEXT_PUBLIC_PROTOTYPE=1 npm run dev` |

In local dev with no `.env` Supabase values, plain `npm run dev` also falls back
to prototype mode. There is a `wandersync-prototype` entry in
`.claude/launch.json` too. Demo trip: **George Town long weekend**
(`0a7e1d90-4b2c-4f11-8b6a-9c1d2e3f4a5b`), members You / Mei / Arun.

Tests: `tests/lib/prototype-config.test.ts` locks the guardrail; the four
feature screens have component tests under `tests/components/`.
