# Safety-first pivot — hosted acceptance runbook

Branch: `feat/travel-dna-safety-pivot`. Implements
`docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md`
(revised 2026-09-07) via `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`.

Migrations added: `202609060004` (safety-only profile + organizer frame + member entry),
`202609060005` (backfill v2), `202609060006` (`chat_home()`), `202609060007`
(`trip_enforced_constraints`). `202609060004` **drops** four `user_travel_profiles` columns
that only tests consumed — verify with `202609060002`'s own runbook context that no hosted
app path reads them before applying.

Local coverage: full `npm test` (930+ cases) + `npm run build` green on every slice; PGlite
migration suite applies `202609060001..202609060007` end to end.

> **Do not run against hosted Supabase until the `202609060003` backfill runbook has been
> executed and verified.** This is the acceptance checklist for after apply.

---

## 1. First-login gate + global onboarding

1. Sign in as a brand-new user. Expect a `307` redirect to `/onboarding` before any trip UI.
   Deep-linking to `/trips/<any id>` or `/chats` also redirects to
   `/onboarding?next=<that path>`.
2. `/login`, `/auth/callback`, `/onboarding`, `/api/onboarding` are never redirected
   (no loop).
3. Complete onboarding: pick nothing on the safety screen, skip the dial, Finish. Expect a
   `user_travel_profiles` row with `onboarding_completed_at` set, `serendipity_epsilon =
   0.150`, `travel_vibe` null, and `router.replace` to land on `/chats` (Back does not
   reopen the survey).
4. Re-run with a dietary flag (e.g. `no_peanut`) selected and the dial at 5. Expect a
   `user_travel_constraints` row (`kind='dietary'`, `flag='no_peanut'`, `severity='severe'`,
   `confirmed_at` set) and `serendipity_epsilon = 0.300`.
5. Sign in again as the same user → straight to `/chats`, no gate.
6. `/preferences` renders the same wizard pre-seeded; saving bumps `profile_revision`
   (optimistic concurrency — a stale tab gets `409 STALE_PROFILE` and a Reload affordance).

## 2. Organizer-framed trip creation

1. On `/chats` with no groups: the empty state offers **Create your first trip group**.
2. Create with a name, destination, a trip style, and a start+end date. Expect a `trips`
   row with `status='ready'`, `trip_mode` set, a matching owner `trip_members` row, and a
   redirect into `/trips/<id>/chat`.
3. Create with a rough length instead of dates. Expect `status='draft'`,
   `planned_duration_days` set, chat usable, and Plan/Timeline shown disabled in the trip
   nav ("Add trip dates to unlock planning").
4. `GET /api/chats` returns the caller's groups only, ordered by most recent chat activity,
   with bounded metadata (no full message bodies, ≤8 avatars). A second user who is not a
   member sees neither group.

## 3. Per-trip member entry + alignment summary

1. Open `/trips/<id>/entry` (or "Your prefs" in the trip nav). The preview shows organizer,
   destination, dates/length, member count, proposed budget, pace.
2. Submit availability (whole trip), a budget tier, a pace, and confirm the saved safety
   flag. Expect one `trip_member_entries` row for the caller.
3. Invite a second user into the trip (manual `trip_members` insert during the compat
   window), have them submit their entry with a different budget and one saved flag
   **unchecked** (a per-trip override). `trip_alignment_summary(<id>)` now returns a JSON
   object: `memberCount = 2`, `budget.{min,max}`, a pace histogram, an availability split,
   and `safetyOverrides` counts. It contains **no user id and no name**.
4. With only one entry present, `trip_alignment_summary` returns `null` (de-anonymization
   floor).

## 4. Gate unions global + trip constraints

1. Both members have `no_peanut` (severe) saved globally. Generate an itinerary that would
   include a food POI with unknown or positive peanut risk. Expect the hard-constraint gate
   to reject it (fail-closed), exactly as a trip-scoped severe constraint would.
2. `select * from public.trip_enforced_constraints('<trip id>')` as each member returns the
   union of both members' active global confirmed constraints and the trip's, deduped, with
   the strictest severity — and only `(kind, flag, severity)` columns.
3. As a non-member: the same call raises `42501`.
4. Retiring a member's global flag (`retired_at = now()`) removes it from the projection on
   the next call; the itinerary can then include the previously-blocked POI.

## 5. Shared selected-trip navigation

1. `/trips/<id>` redirects to `/trips/<id>/chat` (Chat is the default).
2. The trip nav shows Chat / Plan / Timeline / Your prefs and an always-visible **All trip
   groups** link back to `/chats`. The active tab is marked.
3. `/trips/<id>/workspace` redirects to `/trips/<id>/plan`. `WorkspaceShell` has no
   standalone "Timeline jigsaw" toggle.
4. Every onboarding / chat / plan / timeline / entry screen has a visible route back to the
   group list.

## 6. Two-user RLS isolation

Repeat §2–§4 with two hosted accounts. Confirm: a non-member cannot list, read, subscribe
to, or write another trip's chat; `GET /api/trips/<other trip>/member-entry` and
`trip_alignment_summary` both `403`/raise for a non-member; `user_travel_profiles` /
`user_travel_constraints` reads only ever return the caller's own rows.
