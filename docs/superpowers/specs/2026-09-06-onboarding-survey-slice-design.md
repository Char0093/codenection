# Onboarding survey (Travel DNA) — slice 1 design

> Status: approved for implementation planning, 2026-09-06.
> Binding specification: `Implementation_Plan.md` §II-a ("Hybrid preference model")
> and Task 1.6 ("Onboarding questionnaire (Travel DNA)"). This document does **not**
> replace them; it records the decisions, schema deltas, and deferrals for the first
> implementation slice only.

## 1. Scope

### In scope (this slice)

A member can complete a compact preference survey for a trip and have the answers
persisted. Specifically:

- A five-screen wizard plus a "Quick mode" (dealbreakers + walking cap + budget only).
- One transactional write path that stores the answers across `traveler_profiles`
  (soft baseline) and `trip_constraints` (dealbreakers, via the existing
  self-confirmed path).
- A dedicated route `/trips/[tripId]/onboarding`.
- A dismissible, non-blocking "Complete your Travel DNA" nudge on the workspace and
  the trip-setup dashboard, shown while the member has no completed profile.
- Tests: domain helpers, wizard component, RPC + RLS (PGlite), API route.

### Out of scope (later slices / other tasks)

- `components/travel-preferences-editor.tsx`, `/trips/[tripId]/preferences` page + API
  (the always-available "My Travel Preferences" editor).
- `onboarding/summary` "Group Conductor" endpoint (needs a member-invite flow that
  does not exist yet).
- Realtime "requirements/preferences changed" announcements.
- The "Apply to future suggestions" / "Review current itinerary" post-edit flow
  (depends on Task 3.5's confirmation primitive).
- `interest_vector` embedding from the vibe answer — owned by Task 1.3.
- Removing or downgrading a confirmed dealbreaker, and its supersession/audit model —
  owned by Task 1.3. **This slice is add-only for dealbreakers** (see §6).

## 2. How it maps onto the binding spec

| §II-a step | UI | This slice writes |
| --- | --- | --- |
| 1. Travel vibe | single-select cards | `traveler_profiles.travel_vibe` (raw enum; `interest_vector` stays null) |
| 2. Dealbreaker vault | toggle chips + walking-cap | `trip_constraints` rows (dietary / religious_access / mobility) + `traveler_profiles.mobility_threshold_m` |
| 3. Energy & wallet | two segmented controls | `traveler_profiles.budget_lean`, `traveler_profiles.pace` |
| 4. Social role | single-select list | `traveler_profiles.social_role` (private) |
| 5. Surprise dial | 1–5 range | `traveler_profiles.serendipity_epsilon` (grid-mapped) |

## 3. Data model

New migration: `supabase/migrations/202609060001_onboarding_profile.sql`.

### 3.1 New enum

```
create type public.traveler_travel_vibe as enum ('heritage', 'food', 'nature', 'urban');
```

### 3.2 Columns added to `traveler_profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `travel_vibe` | `traveler_travel_vibe` null | Raw step-1 answer. `interest_vector` remains null; Task 1.3 embeds from this column via its fixed tag→dimension map. |
| `budget_lean` | `public.budget_tier` null | Step-3 cost-tier lean. Reuses the existing trip-level enum, not a new scale. Private via the table's existing self-read-only RLS. |
| `onboarding_completed_at` | `timestamptz` null | Distinguishes incomplete / Quick / full completion. Written server-side. |
| `profile_revision` | `bigint not null default 1 check (profile_revision >= 1)` | Optimistic-concurrency token. **Separate from `trips.revision`.** |

### 3.3 Concurrency

`BEFORE UPDATE` trigger on `traveler_profiles` (`security definer`, `set search_path = ''`):
sets `new.updated_at = now()` and `new.profile_revision = old.profile_revision + 1`,
ignoring any client-supplied value.

`BEFORE INSERT` trigger forces `new.profile_revision = 1`.

### 3.4 Column-scoped grants (replace the table-wide grant from `202609050006`)

```
revoke insert on public.traveler_profiles from authenticated;
grant insert (trip_id, trip_member_id, travel_vibe, budget_lean, pace, social_role,
              serendipity_epsilon, mobility_threshold_m, onboarding_completed_at)
  on public.traveler_profiles to authenticated;

revoke update on public.traveler_profiles from authenticated;
grant update (travel_vibe, budget_lean, pace, social_role, serendipity_epsilon,
              mobility_threshold_m, onboarding_completed_at)
  on public.traveler_profiles to authenticated;
```

`id`, `trip_id`, `trip_member_id`, `created_at`, `updated_at`, `profile_revision` are
not client-writable. A `security invoker` RPC (§4) is subject to the same grants.

### 3.5 RLS invariant fix (member/trip pair)

The existing `202609050006` UPDATE policy does not re-check that `trip_member_id`
belongs to `trip_id` (the INSERT policy does). Fix structurally:

```
alter table public.trip_members
  add constraint trip_members_trip_id_id_key unique (trip_id, id);

alter table public.traveler_profiles
  add constraint traveler_profiles_member_in_trip_fk
  foreign key (trip_id, trip_member_id)
  references public.trip_members (trip_id, id) on delete cascade;
```

`unique (trip_id, id)` on `trip_members` does not exist today and must be added
explicitly in this exact column order before the composite FK can reference it.
Also drop and recreate the UPDATE policy with the membership-pair `exists(...)` in
`WITH CHECK`, matching the INSERT policy (defence in depth; the composite FK is the
load-bearing guarantee). No other RLS/policy changes.

### 3.6 `serendipity_epsilon` mapping

Dial 1–5 → `{0.0, 0.075, 0.15, 0.225, 0.3}` (linear across 0.0–0.3).
`SURPRISE_DIAL_DEFAULT = 3` → `0.15`.

- **Quick mode writes `serendipity_epsilon = 0.15` explicitly**, so Quick and
  "full, dial untouched" agree.
- The column default `0.2` now only ever applies to a row that was created without
  going through the wizard (e.g. a future caps path) and is therefore incomplete.
- `epsilonToSurpriseDial` is defined only for the five grid values. Wizard prefill is
  `onboardingCompletedAt == null ? SURPRISE_DIAL_DEFAULT : epsilonToSurpriseDial(epsilon)`,
  so a legacy `0.2` on an incomplete row shows dial 3, never 4.

### 3.7 Revision semantics

`traveler_profiles` writes do **not** bump `trips.revision`. Step-2 `trip_constraints`
writes bump it via the existing `trip_constraints_bump_revision` trigger — once per
row, standard flags included. That is identical to today's `DietaryConstraintPicker`
behaviour; any increment invalidates stale proposals, so per-submission batching is
not needed and the trigger is left unchanged.

## 4. Transactional write path — `public.submit_onboarding(...)`

```
public.submit_onboarding(p_trip_id uuid, p_expected_revision bigint, p_answers jsonb)
  returns bigint            -- the new profile_revision
  language plpgsql
  security invoker
  set search_path = ''
```

`grant execute ... to authenticated; revoke ... from public, anon;`
All object references schema-qualified. The whole body is one transaction: any
`raise` rolls back every write, including the `trips.revision` bumps from step 3.

### Steps

1. **Membership.** `select tm.id ... where tm.trip_id = p_trip_id and tm.user_id = auth.uid()`;
   null → `raise ... using errcode = '42501'`.
2. **Input validation (independent of Zod — the RPC is directly callable).** Reject:
   `mode` not in `('quick','full')`; missing required keys for the mode; any
   `dealbreakers.<kind>` that is not a JSON array; `jsonb_array_length` beyond the
   kind's vocabulary size; any element outside the kind's flag vocabulary; `walkingCapM`
   not null and outside `[0, 50000]`; (`full`) `surpriseDial` outside `[1,5]`,
   `budgetLean` ∉ `budget_tier`, `pace` ∉ `pace_level`, `vibe` ∉ `traveler_travel_vibe`,
   `socialRole` ∉ `traveler_social_role`. Any failure → `raise ... using errcode = '22023'`.
3. **CAS precheck.** Read `profile_revision`. Row exists and `<> p_expected_revision`
   → `raise '40001'`. No row and `p_expected_revision <> 0` → `raise '40001'`.
4. **Dealbreakers, add-only.** For each submitted `(kind, flag)`:
   `insert into public.trip_constraints (trip_id, trip_member_id, kind, flag, severity,
   source, confirmed_by, confirmed_at) values (..., v_severity, 'manual', v_member_id, now())
   on conflict (trip_member_id, kind, flag) do nothing`. If `not found`, re-select that
   row filtered by `confirmed_at is not null`; still `not found` →
   `raise 'PENDING_CONSTRAINT_CONFLICT' using errcode = 'P0001'`. Never updates or
   deletes a constraint row; no `update` grant is added to `trip_constraints`.
   `v_severity` via a `case`: `no_peanut`, `no_shellfish`,
   `wheelchair_accessible_required` → `severe`; every other supported flag → `standard`.
   This must stay equal to `defaultSeverity` / `defaultReligiousAccessSeverity` /
   `defaultMobilitySeverity` in `lib/domain/constraints.ts` (test in §7).
5. **Profile last.**
   - No row:
     `insert into public.traveler_profiles (...) values (...) on conflict (trip_member_id)
     do nothing returning profile_revision into v_new_revision;`
     `if v_new_revision is null then raise '40001'; end if;` (loses the race → rolls back
     step 4).
   - Row exists:
     `update public.traveler_profiles set <mode fields>, onboarding_completed_at = now()
     where trip_member_id = v_member_id and profile_revision = p_expected_revision
     returning profile_revision into v_new_revision;`
     `if v_new_revision is null then raise '40001'; end if;`
   - `quick` sets `budget_lean, mobility_threshold_m, serendipity_epsilon = 0.15,
     onboarding_completed_at`. `full` also sets `travel_vibe, pace, social_role,
     serendipity_epsilon = <grid(dial)>`. On a `quick` redo the four full-only fields
     are left untouched (preserved, not reset).
6. `return v_new_revision;`

## 5. Server action + API

### `app/actions/onboarding.ts` (`"use server"`, local `myMembership` helper, mirrors `constraints.ts`)

- **`getMyOnboarding(tripId)`** — RLS-guarded reads only. Returns:

  ```
  {
    profile: { travelVibe, budgetLean, pace, socialRole, serendipityEpsilon,
               mobilityThresholdM, onboardingCompletedAt } | null,
    profileRevision: number,        // top-level ONLY — never also inside `profile`
    dealbreakers: {
      dietary:         { confirmed: string[], pending: string[] },
      religiousAccess: { confirmed: string[], pending: string[] },
      mobility:        { confirmed: string[], pending: string[] }
    },
    needsOnboarding: boolean         // profile?.onboardingCompletedAt == null
  }
  ```

- **`submitOnboarding(tripId, rawBody)`** — `submitBodySchema.parse(rawBody)`, then one
  `client.rpc("submit_onboarding", { p_trip_id, p_expected_revision, p_answers })`.
  Map by `error.code`:
  - `40001` → `AppError(409, "Your preferences changed in another session. Reload to see the latest.", "STALE_PROFILE")`
  - `42501` → `AppError(403, "You are not a member of this trip.", "FORBIDDEN")`
  - `P0001` + message `PENDING_CONSTRAINT_CONFLICT` → `AppError(409, "A pending suggestion exists for one of these dealbreakers; resolve it in constraint review first.", "PENDING_CONSTRAINT")`
  - `22023` → `AppError(422, "Some answers were invalid. Please review and resubmit.", "INVALID_ONBOARDING")`
  - else → `databaseError(error)`

  Returns `{ profileRevision, needsOnboarding: false }`.

### `app/api/trips/[tripId]/onboarding/route.ts` (wrapper style copied from `constraints/route.ts`)

- `export const dynamic = "force-dynamic";`
- `GET` → `getMyOnboarding`; `headers: { "Cache-Control": "private, no-store" }`.
- `POST` → `requireSameOrigin(request)`, `readJson(request)`, `submitOnboarding`; `200`
  (upsert, not always a create). `errorResponse` already maps `AppError` (incl. 409/422).

### `lib/domain/onboarding.ts` (pure, no I/O)

- `onboardingAnswersSchema = z.discriminatedUnion("mode", [z.strictObject({ mode: "quick", ... }), z.strictObject({ mode: "full", ... })])`.
- `submitBodySchema = z.strictObject({ expectedRevision: z.number().int().min(0), answers: onboardingAnswersSchema })`.
- Each dealbreaker array: `.array(<flagSchema>).max(<VOCAB>.length)` then dedupe via `Set`.
  `walkingCapM`: `z.number().int().min(0).max(50000).nullable()`.
- `budgetLean` / `pace` reuse `budgetTierSchema` / `paceLevelSchema` from `lib/domain/trip.ts`.
- `SOCIAL_ROLES` + `socialRoleSchema` + labels (mirror the DB `traveler_social_role` enum; keep-in-sync comment).
- `TRAVEL_VIBES` + `travelVibeSchema` + `TRAVEL_VIBE_LABELS`.
- `WALKING_CAP_PRESETS` (`500 m` / `1 km` / `2 km` / `No limit`).
- `surpriseDialToEpsilon(1..5)` (guarded, exact grid), `epsilonToSurpriseDial` (grid-only,
  documented contract), `SURPRISE_DIAL_DEFAULT = 3`.

## 6. Frontend

### `components/onboarding-wizard.tsx` (`"use client"`)

Props: `{ tripId: string; initial: OnboardingSnapshot; successHref: string }`.
**No function props** — a Server Component renders this, so it cannot pass `onComplete`.
On a `200` the wizard calls `router.replace(successHref)` itself (`replace`, not `push`,
so Back does not reopen the completed wizard).

State: `mode` (`full` / `quick`, toggled on step 1), `step`, `draft` seeded from
`initial` (dealbreaker `Set`s from `dealbreakers.*.confirmed`; `surpriseDial` via the
§3.6 rule), `pending`, `error`, `expectedRevision = initial.profileRevision` (echoed in
the POST body).

Screens — one primary interaction each, no free-text fields:

1. **Travel vibe** — four single-select cards: heritage / food / nature / urban.
   **Deliberate visual deferral:** the binding spec calls for *image cards*; this slice
   ships `lucide-react` icon + label placeholders. Recorded here and in a code comment;
   real imagery is a later visual pass. Hosts the **Quick mode** toggle → collapses the
   flow to screen 2 + a budget-only screen 3.
2. **Dealbreaker vault** — toggle chips from `DIETARY_FLAG_LABELS`,
   `RELIGIOUS_ACCESS_FLAG_LABELS`, `MOBILITY_FLAG_LABELS` under three subheadings, plus a
   walking-cap segmented control (`WALKING_CAP_PRESETS`). Flags already in
   `initial.dealbreakers.*.confirmed` render **checked + disabled**:
   - dietary → hint "Set previously — remove this under Dietary conditions on the trip dashboard."
   - religious-access / mobility → hint "Set previously — removing this needs constraint
     review, coming with Task 1.3." (The dashboard picker only removes *dietary* flags,
     so those two must not point there.)
   Flags in `*.pending` render read-only as "Suggested — review coming soon".
3. **Energy & wallet** — two segmented controls (budget lean, pace) reusing the
   dashboard's `.segmented` markup. Quick mode shows budget only; this is its last screen.
4. **Social role** — single-select list (`SOCIAL_ROLES`) with a persistent
   "Only you can see this — it never appears to other members" note.
5. **Surprise dial** — a 1–5 `range` input with end labels and a visible current-value label.

Navigation: Back / Next; the final screen's button is **Finish** →
`POST /api/trips/{tripId}/onboarding` with `{ expectedRevision, answers }`.
`fetch` wrapper copied from `DietaryConstraintPicker` (`cache: "no-store"`, JSON,
throw on `!ok` with the parsed `error`). Responses:

- `200` → `router.replace(successHref)`.
- `409 STALE_PROFILE` → message + a "Reload" affordance (re-fetches the snapshot).
- `409 PENDING_CONSTRAINT` / `422` → inline error, stay on the current step.

Progress indicator ("Step 3 of 5" or a "Quick" badge). Finish disabled while `pending`.

### Accessibility

- On every step change, move focus to the new step's heading (`tabIndex={-1}` + `.focus()`).
- The error region is `role="alert"`.
- The surprise slider carries `aria-valuetext` (e.g. "3 of 5 — balanced") plus a visible
  current-value label.

### `app/trips/[tripId]/onboarding/page.tsx` (server component)

Auth-guard → `redirect("/login")`; `tripRepository().getTrip(tripId)` (`notFound()` on
failure); resolve `selfMemberId` via `listTripMembers`; `getMyOnboarding(tripId)`.
Renders `<OnboardingWizard tripId={trip.id} initial={snapshot}
successHref={`/trips/${trip.id}/workspace`} />` in a centered single-column layout with
the trip name as heading. `export const dynamic = "force-dynamic";`

### Nudge

Dismissible, non-blocking banner: "Complete your Travel DNA · about 60 seconds" + a link
to `/trips/[tripId]/onboarding`. Shown while `needsOnboarding` is true. Dismiss is
component state only (per session), not persisted.

- **Workspace:** `app/trips/[tripId]/workspace/page.tsx` also calls `getMyOnboarding` and
  passes `needsOnboarding` to `WorkspaceClient`; the banner renders in
  `features/workspace/workspace-client.tsx` (or `workspace-shell.tsx`).
- **Dashboard:** `components/trip-setup-dashboard.tsx` renders the same banner in the
  Setup panel near `DietaryConstraintPicker`, gated on `trip !== null`. `needsOnboarding:
  boolean` is added to the existing `/trips/[tripId]` detail payload (`TripDetail` type +
  `app/api/trips/[tripId]/route.ts` assembly) — one field, no extra round-trip. The
  dashboard must update this state everywhere it updates `dietaryFlags`: initial load
  (`initialize`), trip switching / detail refresh (`refreshDetail`), and new-trip reset
  (`newTrip`).

## 7. Testing

- **`tests/domain/onboarding.test.ts`** — `surpriseDialToEpsilon` grid + guard;
  `epsilonToSurpriseDial` grid + contract; schema rejects unknown `mode`, extra keys
  (strict), oversize dealbreaker arrays, invalid enums, `walkingCapM` out of bounds;
  dedupe collapses repeats.
- **`tests/components/onboarding-wizard.test.tsx`** (RTL, like
  `tests/components/trip-setup-dashboard.test.tsx`) — full path renders all five steps;
  Quick toggle collapses to two screens and submits `mode: "quick"`; every answer lands
  in the POST body; Back preserves entered answers; confirmed dealbreaker chips render
  locked with the correct per-kind hint; `409 STALE_PROFILE` shows the reload affordance;
  a failed POST surfaces an inline error; focus moves to the step heading on navigation.
  `fetch` mocked; `next/navigation` `router.replace` mocked and asserted on `200`.
- **`tests/database/onboarding-rls.test.ts`** (PGlite, like
  `tests/database/constraints-rls.test.ts`):
  - migration applies cleanly in the shared PGlite instance;
  - `submit_onboarding` happy path: creates the `traveler_profiles` row + confirmed
    `trip_constraints`, sets `onboarding_completed_at`, returns `1`;
  - **Quick-mode assertion:** after a `mode: "quick"` submit the stored row has
    `serendipity_epsilon = 0.15`, `pace = 'balanced'`, `travel_vibe is null`,
    `social_role is null`;
  - **CAS:** a second call with a stale `expectedRevision` raises `40001` and leaves
    **no** partial `trip_constraints` writes (atomic rollback asserted);
  - **non-member** caller → `42501`;
  - another member (including the trip owner) still cannot `select` the row;
  - direct `authenticated` `insert` / `update` of `profile_revision` or `trip_id` is
    rejected by the column grant;
  - composite-FK mismatch (member from another trip) is rejected;
  - **RPC validation is independent of Zod:** call the RPC directly with invalid JSON —
    `mode: "bogus"`, missing `budgetLean`, `dealbreakers.dietary` as a string,
    an over-long array, a bad enum value, `surpriseDial: 9`, `walkingCapM: -5` — each
    raises `22023` and writes nothing;
  - **severity sync:** for every flag in all three vocabularies, a one-flag submit stores
    the severity that the corresponding `lib/domain/constraints.ts` helper returns.
- **`tests/api/onboarding.test.ts`** — `GET` pre-completion response shape; `POST`
  same-origin enforcement; `422` on a malformed body; `409` code mapping.
- `docs/implementation-status.md` Task 1.6 → **Partial**, listing what shipped and the
  add-only dealbreaker caveat + the deferred list.
- `npm run lint`, `npm test`, `npm run build`.

## 8. File list

### Create

- `supabase/migrations/202609060001_onboarding_profile.sql`
- `lib/domain/onboarding.ts`
- `app/actions/onboarding.ts`
- `app/api/trips/[tripId]/onboarding/route.ts`
- `components/onboarding-wizard.tsx`
- `app/trips/[tripId]/onboarding/page.tsx`
- `tests/domain/onboarding.test.ts`
- `tests/components/onboarding-wizard.test.tsx`
- `tests/database/onboarding-rls.test.ts`
- `tests/api/onboarding.test.ts`

### Modify

- `app/trips/[tripId]/workspace/page.tsx` — fetch `needsOnboarding`, pass down
- `features/workspace/workspace-client.tsx` (and/or `features/workspace/workspace-shell.tsx`) — nudge banner
- `components/trip-setup-dashboard.tsx` — nudge banner in Setup panel; track `needsOnboarding` across load / switch / refresh / reset
- `app/api/trips/[tripId]/route.ts` (+ its detail assembly) — add `needsOnboarding` to `TripDetail`
- `app/globals.css` — `.onboarding-*` classes
- `docs/implementation-status.md` — Task 1.6 status

### Deferred (explicitly not in this slice)

`components/travel-preferences-editor.tsx` · `app/trips/[tripId]/preferences/page.tsx` ·
`app/api/trips/[tripId]/preferences/route.ts` · `app/api/trips/[tripId]/onboarding/summary/route.ts`
(Group Conductor) · realtime announce · Apply-to-future / Review-itinerary ·
`interest_vector` embedding (Task 1.3) · dealbreaker removal / supersession (Task 1.3).
