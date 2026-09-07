# First-login Travel DNA and trip chat groups — implementation plan

> Implements `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md`.
> This plan supersedes future entry-flow work in the earlier trip-scoped onboarding plan;
> that file remains implementation history. Use TDD and one reviewable commit per task.

## Task 1 — Lock the global contracts in domain tests

**Files:** modify `lib/domain/onboarding.ts`; create/modify domain and route-contract tests.

- Remove `tripId` from global onboarding input contracts.
- Preserve typed safety constraints, the optional epsilon grid, strict objects, and vocabulary caps.
- Add schemas for organizer-framed trip creation, pre-join member inputs, and chat-home summaries.
- Test copy-independent behavior, invalid values, dedupe, and boundary values.

## Task 2 — Add global profile, global constraints, and organizer trip frames

**Files:** create `supabase/migrations/202609060002_user_travel_profile_chat_groups.sql`;
extend PGlite migration/RLS tests.

- Create `user_travel_profiles` and `user_travel_constraints` with self-only RLS,
  column-scoped grants, completed-shape checks, and server-managed revisions.
- Add a transactional `submit_user_onboarding(expected_revision, answers)` RPC.
- Add trip-frame and member-entry fields without weakening generation-time validation.
- Add `create_trip_group(...)` RPC that validates destination, dates/duration, and broad trip mode,
  then creates the trip and organizer membership atomically.
- Test anonymous, self, cross-user, malformed input, CAS races, rollback, and constraint
  severity parity.

## Task 3 — Backfill and compatibility

**Files:** same migration or a following data migration; migration tests; a hosted
verification runbook.

- Backfill the most recently completed trip profile per user with deterministic ordering.
- Backfill only safe, confirmed manual constraints; leave ambiguous rows trip-scoped.
- Preserve the old tables and reads during the compatibility window.
- Produce counts for source users, inserted global profiles, skipped ambiguous constraints,
  and conflicts. Test idempotency.

## Task 4 — Enforce the first-login gate

**Files:** authenticated layout/middleware helpers, `app/onboarding/page.tsx`, auth tests.

- Resolve completion server-side after authentication.
- Exempt login, callback, onboarding, and onboarding API paths from redirect gating.
- Redirect incomplete users to `/onboarding`; redirect completed root visits to `/chats`.
- Preserve an authorized deep-link destination through onboarding without creating an
  open redirect.
- Test new, incomplete, complete, signed-out, callback, and redirect-loop cases.

## Task 5 — Convert onboarding to a global safety baseline

**Files:** onboarding page, wizard, actions, `/api/onboarding`, component/API tests.

- Use safety-first copy and remove the trip name/`tripId` dependency.
- Keep the flow to a safety-vault screen plus optional exploration dial, with accessible progress,
  focused headings, meaningful slider feedback, and a final safety summary.
- Submit through the global RPC and `router.replace('/chats')` on success.
- Add an always-available `/preferences` editor backed by the same revision token.
- Test full, Quick, Back, stale reload, retry, reduced motion, and mobile text fit.

## Task 6 — Build the chat-group home and group creation

**Files:** `app/chats/page.tsx`, chat-home components, `/api/chats`, repository/actions,
component/API/database tests.

- Render the empty state and membership-scoped trip-group list.
- Create an organizer-framed trip atomically and open `/trips/[tripId]/chat`.
- Order groups by recent chat activity without unbounded message reads.
- Validate destination, dates/duration, and broad trip mode at creation; collect budget, pace,
  availability, and destination-specific POI preferences per trip rather than globally.
- Do not ship a working-looking invite action; show the deferred state honestly if the
  control is present.

## Task 7 — Consolidate selected-trip navigation

**Files:** authenticated app shell, trip chat route, existing dashboard/workspace routes,
navigation and browser tests.

- Make Chat the default selected-trip surface, with Plan and Timeline in the shared left
  navigation.
- Remove duplicate top-level Timeline/Jigsaw links and dead-end standalone navigation.
- Redirect compatible legacy workspace URLs into the selected-trip shell.
- Ensure every onboarding, chat, plan, and timeline screen has a visible route back to
  the group list.

## Task 8 — Use global defaults in planning safely

**Files:** constraint gate/profile readers, planning repository, tests.

- Join trip membership to global profile defaults without exposing raw cross-member data.
- Evaluate global confirmed constraints plus trip-specific confirmed constraints.
- Let current-trip explicit preferences and expiring signals reweight global soft defaults
  without overwriting them.
- Test cross-trip isolation, private social-role handling, and fail-closed safety behavior.

## Task 9 — Verification and status handoff

- Update `docs/implementation-status.md` only after each corresponding behavior ships.
- Run lint, typecheck, all tests, production build, and browser tests.
- Hosted acceptance: first login -> onboarding -> chat home -> create group -> send/reload
  chat; verify Supabase rows and two-user RLS isolation.
- Record invitation delivery, unread notifications, and multi-room chat as deferred.

## Dependency order

Tasks 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9. Tasks 6 and 7 may be developed in
parallel after Task 4, but neither ships before the database and onboarding backfill gates.
