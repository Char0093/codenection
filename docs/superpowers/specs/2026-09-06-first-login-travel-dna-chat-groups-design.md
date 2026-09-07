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

The survey asks only for information that is safe and useful to reuse across trips. It
contains one safety-vault screen for confirmed dietary, religious-access, allergy, and
mobility requirements, plus an optional general surprise-tolerance dial. The flow targets
roughly 10 seconds and supports “none” or skip. It does not ask for a budget, daily pace,
social role, or abstract destination interests: those values are context-dependent and are
collected when a person creates or joins a named trip. The page is `/onboarding`, has no
trip name in the title, and explains that saved safety requirements will be confirmed for
each trip the user joins.

On success, `router.replace('/chats')` prevents Back from reopening the completed survey.

### 2.3 Chat-group home

`/chats` is the first post-onboarding destination and the authenticated product home.

- With no memberships, show an honest empty state and **Create your first trip group**.
- Otherwise list the user's trips ordered by most recent chat activity, with trip name,
  destination/date summary when known, latest-message preview, unread state when that
  infrastructure exists, and member avatars.
- **New trip group** is created by one organizer, who supplies destination, dates or
  duration, and a broad trip mode. Proposed budget and split-and-regroup permission are
  optional. This creates the frame shown to future invitees before they join.
- Selecting a group opens `/trips/[tripId]/chat`.
- The selected-trip shell exposes Chat, Plan, and Timeline navigation. Chat is the
  default view; duplicate standalone workspace/jigsaw entry points are retired.
- Planning and generation are available only after the organizer's required trip frame is valid.
  Chat is usable once that frame exists.

### 2.4 Invitations

Invitations are deliberately deferred. The eventual boundary is fixed now:

- an invitation targets one `trip_id` and one role;
- before acceptance it shows the organizer, destination, dates, current member count,
  proposed budget, and pace; it collects the invitee's availability, per-trip budget,
  pace, and confirmation/override of saved safety requirements;
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
| `travel_vibe` | nullable and optional general baseline only |
| `serendipity_epsilon` | non-null numeric on the existing five-value grid |
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

### 3.3 Organizer trip frame and member entry

The organizer creates the trip with destination, dates or duration, and broad trip mode.
The group can chat once this frame exists. Each later member supplies their per-trip
availability, budget tier, pace, and saved-safety confirmation before joining. The app
then produces only an aggregate, non-attributable alignment summary and collects
destination-specific candidate ratings; it never exposes private budget or health detail.

## 4. Migration and compatibility

The migration must be additive and reversible at the application boundary:

1. Create global profile and constraint tables, triggers, grants, and RLS.
2. Add organizer-trip-frame and member-entry data without weakening generation-time validation.
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
- `POST /api/chats` — create framed trip + organizer membership atomically; returns `201`.
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
- An empty chat home can create an organizer-framed trip and immediately enter its chat.
- One trip has one chat history; there is no duplicate chat-group ownership model.
- A non-member cannot list, read, subscribe to, or write another trip's chat.
- A member cannot join before seeing the trip frame and submitting the required per-trip inputs.
- Existing completed onboarding data is backfilled deterministically without leaking
  another user's answers.
- Desktop and mobile flows pass keyboard, focus, reduced-motion, and responsive checks.

## 8. Explicit deferrals

- Email/link invitation delivery and acceptance UI.
- Unread counts and notification delivery.
- Multiple chat rooms within one trip.
- Public groups or public chat history.
- Organization/team workspaces.
