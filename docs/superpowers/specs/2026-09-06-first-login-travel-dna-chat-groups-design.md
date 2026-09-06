# First-login Travel DNA and trip chat groups — design

> Status: approved product direction, 2026-09-06.
> This specification supersedes the entry-flow and ownership decisions in
> `2026-09-06-onboarding-survey-slice-design.md`. That earlier document remains the
> implementation record for the delivered trip-scoped onboarding slice.

## 1. Product decision

Travel DNA describes how a person generally likes to travel. It is collected once after
the user's first authenticated login, before the user needs to create or join a trip.
After completion, the user lands on a chat-group home. Each chat group is exactly one
trip; the trip is the authorization, membership, and chat-history boundary.

```text
Sign in
  -> incomplete Travel DNA? /onboarding
  -> complete Travel DNA?   /chats

/chats
  -> create a trip group
  -> select an existing trip group
  -> /trips/[tripId]/chat
```

There is no separate `chat_groups` table. Creating a group creates a `trips` row and its
owner `trip_members` row in one transaction. `chat_messages.trip_id` remains the sole
chat-history scope.

## 2. Experience

### 2.1 First-login gate

- Authentication success resolves the caller's global Travel DNA completion state.
- A missing profile or null `onboarding_completed_at` redirects to `/onboarding`.
- `/login`, `/auth/callback`, `/onboarding`, and `/api/onboarding` are exempt from the
  gate so it cannot create a redirect loop.
- A completed user is never forced through onboarding again. They can open **My Travel
  Preferences** later to edit individual answers.
- Existing authenticated users are evaluated by the same rule after this change ships.

### 2.2 Travel DNA survey

The survey asks about the member's usual travel style, not what they want for one named
trip. Copy uses forms such as “What kind of traveler are you?” and “How do you usually
like to travel?” The five answer groups remain:

1. broad travel vibe;
2. confirmed dietary, religious-access, and mobility requirements plus walking comfort;
3. usual budget style and preferred daily pace;
4. the role they naturally take in a group, private by default;
5. general surprise tolerance.

The full flow remains under 60 seconds. Quick mode remains available for essentials.
The page is `/onboarding`, has no trip name in the title, and explains that the baseline
will tune recommendations inside any trip the user joins.

On success, `router.replace('/chats')` prevents Back from reopening the completed survey.

### 2.3 Chat-group home

`/chats` is the first post-onboarding destination and the authenticated product home.

- With no memberships, show an honest empty state and **Create your first trip group**.
- Otherwise list the user's trips ordered by most recent chat activity, with trip name,
  destination/date summary when known, latest-message preview, unread state when that
  infrastructure exists, and member avatars.
- **New trip group** creates a draft trip from a required group name. Destination and
  dates are optional until planning begins.
- Selecting a group opens `/trips/[tripId]/chat`.
- The selected-trip shell exposes Chat, Plan, and Timeline navigation. Chat is the
  default view; duplicate standalone workspace/jigsaw entry points are retired.
- Planning and generation are gated until the draft trip has destination, start date,
  and end date. Chat is usable before those fields are complete.

### 2.4 Invitations

Invitations are deliberately deferred. The eventual boundary is fixed now:

- an invitation targets one `trip_id` and one role;
- accepting it creates one `trip_members` row;
- membership grants access to only that trip's chat history and planning data;
- invite tokens are single-use, expiring, stored hashed, and never embedded in chat
  history;
- no invitation UI should imply that sending works until the flow is implemented.

## 3. Data ownership

### 3.1 Global Travel DNA

Add `user_travel_profiles`, keyed by the authenticated user rather than a trip member:

| Column | Contract |
| --- | --- |
| `user_id` | `uuid primary key references auth.users(id) on delete cascade` |
| `travel_vibe` | nullable `traveler_travel_vibe` |
| `budget_lean` | nullable `budget_tier` |
| `pace` | non-null `pace_level`, default `balanced` |
| `social_role` | nullable `traveler_social_role`; self-read only |
| `serendipity_epsilon` | non-null numeric on the existing five-value grid |
| `mobility_threshold_m` | nullable integer, `0..50000` |
| `onboarding_completed_at` | nullable `timestamptz` |
| `profile_revision` | server-managed bigint CAS token |
| timestamps | `created_at`, `updated_at` |

Add `user_travel_constraints` for globally confirmed typed requirements:

| Column | Contract |
| --- | --- |
| `id` | UUID primary key |
| `user_id` | references `auth.users(id)` on delete cascade |
| `kind`, `flag`, `severity` | same typed vocabularies and severity rules as `trip_constraints` |
| `confirmed_at` | non-null for enforced onboarding answers |
| audit fields | creator, created timestamp, nullable `supersedes_id` and `retired_at` |

RLS is self-read/self-write. Cross-member clients never read another user's global
profile or global constraints. Planner and ranking code obtains only the minimum typed
projection through narrowly scoped server functions.

An active global constraint has `retired_at is null`, with at most one active row per
`(user_id, kind, flag)`. An edit retires the old row and inserts its replacement with
`supersedes_id` in the same transaction. Removal retires without replacement. Only a
Section IX privacy/deletion request hard-deletes the audit chain.

### 3.2 Trip-specific state

- `trip_interest_signals` remains trip-scoped and may temporarily reweight the global
  baseline. It never overwrites global Travel DNA.
- `trip_constraints` remains for requirements that apply only to one trip and for
  chat-derived candidates requiring confirmation.
- The hard-constraint gate evaluates the union of each participating member's active
  global confirmed constraints and the trip's active confirmed constraints.
- Trip-specific scheduling windows and explicit current-trip requests outrank global
  soft defaults without mutating them.
- The delivered `traveler_profiles` table becomes a compatibility/read-migration source,
  not the canonical home of Travel DNA.

### 3.3 Draft trips

To allow conversation before itinerary setup, a trip group can be created with a name
only. Add an explicit draft/setup state and permit destination/dates to remain null while
draft. Database checks require destination and valid dates before the trip becomes
`ready`; generation and scheduling enforce `ready` server-side.

## 4. Migration and compatibility

The migration must be additive and reversible at the application boundary:

1. Create global profile and constraint tables, triggers, grants, and RLS.
2. Add draft-trip state without weakening generation-time validation.
3. Backfill at most one global profile per existing user from their most recently
   completed `traveler_profiles` row. Record deterministic tie-breaking.
4. Backfill global constraints only from confirmed manual rows whose meaning is safe to
   treat as a general requirement; ambiguous trip-specific rows remain trip-scoped.
5. Keep the old trip onboarding API read-only during a compatibility window; stop new
   writes after the global endpoint ships.
6. Remove compatibility code only after hosted backfill counts and sampled rows are
   verified. Do not drop historical tables in the first migration.

## 5. API and routing contracts

- `GET /api/onboarding` — caller's global snapshot; private, no-store.
- `POST /api/onboarding` — strict schema, same-origin, revision-checked transactional
  submission; returns the new profile revision.
- `GET /api/chats` — trips where the caller has membership, with bounded latest-message
  metadata only.
- `POST /api/chats` — create draft trip + owner membership atomically; returns `201`.
- Existing `/api/trips/[tripId]/chat/*` operations remain trip-scoped.
- Authenticated root redirects to `/onboarding` or `/chats`; deep links preserve their
  destination through onboarding only when the user is authorized after completion.

## 6. Safety and privacy invariants

- First-login onboarding is never inferred from chat and never silently completed.
- Global preferences are private by default; APIs do not return another member's raw
  answers.
- Social role is never exposed cross-member.
- Hard constraints require explicit confirmation and remain fail-closed in planning.
- Chat history is visible only to current members of its trip and is deleted with the
  trip under the existing retention policy.
- Creating a chat group does not grant access to any other trip.
- The assistant receives only the selected trip and a bounded recent-message window.

## 7. Acceptance criteria

- A new authenticated user is redirected to `/onboarding` before seeing trip UI.
- Completing onboarding once persists a global profile and redirects to `/chats`.
- A returning completed user goes directly to `/chats`.
- An empty chat home can create a draft trip group and immediately enter its chat.
- One trip has one chat history; there is no duplicate chat-group ownership model.
- A non-member cannot list, read, subscribe to, or write another trip's chat.
- Planning refuses a draft trip until required setup is complete.
- Existing completed onboarding data is backfilled deterministically without leaking
  another user's answers.
- Desktop and mobile flows pass keyboard, focus, reduced-motion, and responsive checks.

## 8. Explicit deferrals

- Email/link invitation delivery and acceptance UI.
- Unread counts and notification delivery.
- Multiple chat rooms within one trip.
- Public groups or public chat history.
- Organization/team workspaces.
