# Travel DNA safety-first pivot — umbrella implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement each slice below. Each slice is
> its own fully-detailed sub-plan and its own reviewable unit. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Land the product pivot captured in the 2026-09-07 documentation edits: first-login
onboarding shrinks to a ~10-second safety check, and everything context-dependent (budget,
pace, availability, POI interests) moves to an organizer-led trip-entry flow.

**Architecture:** Additive at the application boundary but *not* at the schema boundary — one
new migration drops the four now-unused `user_travel_profiles` columns and reworks the two
new-flow RPCs, because Tasks 1–3 of the prior plan already shipped them against the old
design (`a65a108`, `543edb7`, `412c7db`, `d258c0d`, all on `origin/main`). No production
`app/` or `lib/` code consumes `user_travel_profiles`, `user_travel_constraints`,
`submit_user_onboarding`, or `create_trip_group` yet — only tests — so the foundation rework
(Slice 1) is self-contained. Later slices build the gate, the global onboarding page, the
chat-group home, and the pre-join member-entry flow on top of the reworked contracts.

**Tech Stack:** Next.js App Router (RSC + route handlers), Supabase (Postgres + RLS), Zod
domain contracts, Vitest + PGlite for migration/RLS tests, Testing Library for components.

**Spec:** `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md`
(revised 2026-09-07). Prior coarse plan:
`docs/superpowers/plans/2026-09-06-first-login-travel-dna-chat-groups.md`. The stale
`2026-09-06-first-login-task4-5-subplan.md` is **superseded** by Slice 2 here — do not
execute it (it selects `budget_lean/pace/social_role/mobility_threshold_m` and describes a
five-screen wizard, both removed by this pivot).

## Global Constraints

Copied verbatim from the spec; every slice's requirements implicitly include this section.

- **First-login flow.** One safety-vault screen (confirmed dietary, religious-access,
  allergy, and mobility requirements) plus **one optional** general surprise-tolerance dial.
  Targets ~10 seconds. Supports "none" and skip. It does **not** ask for a budget, daily
  pace, social role, or abstract destination interests. Page is `/onboarding`, no trip name
  in the title.
- **Gate exemptions.** `/login`, `/auth/callback`, `/onboarding`, and `/api/onboarding` are
  exempt from redirect gating so it cannot loop. On success `router.replace('/chats')`.
- **`user_travel_profiles` end state.** Columns: `user_id` (PK → `auth.users(id)` on delete
  cascade), `travel_vibe` (nullable, optional general baseline only — **not** set by
  onboarding), `serendipity_epsilon` (non-null numeric on the five-value grid
  `0.0, 0.075, 0.15, 0.225, 0.3`), `onboarding_completed_at` (nullable `timestamptz`),
  `profile_revision` (server-managed bigint CAS token), `created_at`, `updated_at`.
- **`user_travel_constraints`.** Unchanged by this pivot: typed `(kind, flag, severity)` with
  the same vocabularies and severity rules as `trip_constraints`; non-null `confirmed_at`
  for enforced answers; audit fields `created_by`, `created_at`, nullable `supersedes_id`
  and `retired_at`; at most one active row per `(user_id, kind, flag)`; edit = retire + insert
  with `supersedes_id` in one transaction.
- **RLS.** Global profile and global constraints are self-read/self-write. APIs never return
  another member's raw answers. Social role is never exposed cross-member. Planner/ranking
  code obtains only the minimum typed projection through narrowly scoped server functions.
- **Organizer trip frame.** Trip creation requires destination, dates **or** duration, and a
  broad trip mode. Proposed per-person budget and split-and-regroup permission are optional.
  Creating the frame enables chat; **generation still requires concrete valid dates**
  (`trips.status = 'ready'`, unchanged DB backstop).
- **Pre-join.** Before acceptance an invitee sees a preview (organizer, destination, dates,
  current member count, proposed budget, pace) and submits per-trip inputs (full/partial
  availability, personal budget tier, pace, confirmation/override of saved safety
  requirements). The app then posts only an **aggregate, non-attributable** alignment summary
  and collects destination-specific candidate ratings. It never reveals a member's private
  budget, health detail, or veto attribution.
- **One trip = one `trips` row.** No `chat_groups` table. `chat_messages.trip_id` is the
  sole chat-history scope. Creating a group creates the `trips` row + owner `trip_members`
  row in one transaction.
- **Migration hygiene.** Keep the old trip-scoped onboarding API read-only during the
  compatibility window; stop new writes once the global endpoint ships. Do not drop
  historical tables (`traveler_profiles`, `trip_constraints`) in this pass. Preserve the
  `dev_test@gmail.com` generation rate-limit exemption verbatim.
- **Process.** TDD (RED → GREEN → commit). One reviewable commit per task. Frequent commits.
  Every slice ends green on `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

---

## Slice breakdown & dependency order

Strict order: **1 → 2 → 3 → 4 → 5 → 6**. Slices 5 and 6 may start once Slice 3 is merged.
Each slice has (or gets, just before execution) its own detailed sub-plan file.

| Slice | Sub-plan file | Covers (prior-plan tasks) | Ships |
| --- | --- | --- | --- |
| **1. Contracts + schema + backfill** ✅ **DONE** (commits `9e9330c`, `ba9e4e4`, `c6b3a62` on `feat/travel-dna-safety-pivot`) | `2026-09-07-safety-pivot-slice-1-contracts-schema.md` | Tasks 1–3, redone | Safety-only onboarding contract; `202609060004` drops 4 profile columns + reworks `submit_user_onboarding` + replaces `create_trip_group` with the organizer frame + adds `trip_member_entries` / `submit_member_entry` / `trip_alignment_summary`; `202609060005` reworks the backfill. Tests only — no app code. Full suite green (857), lint/typecheck/build clean. |
| **2. First-login gate + global onboarding** ✅ **DONE** (commits `33f08ac`, `2be3e85`, `fc34728`, `a1dafd1`, `2a0cdc8` on `feat/travel-dna-safety-pivot`) | `2026-09-07-safety-pivot-slice-2-gate-onboarding.md` | Tasks 4–5 | `lib/onboarding/gate.ts`; `app/actions/user-onboarding.ts`; `app/api/onboarding/route.ts`; `app/onboarding/page.tsx`; `app/preferences/page.tsx`; `middleware.ts` gate; **new** `components/user-onboarding-wizard.tsx` (two-screen safety-first) — the frozen five-screen `components/onboarding-wizard.tsx` is untouched. Full suite green (891), lint/typecheck/build clean. |
| **3. Chat-group home + organizer trip creation** | `2026-09-07-safety-pivot-slice-3-chats-home.md` (write before exec) | Task 6 | `app/chats/page.tsx` + list/create components; `app/api/chats/route.ts` (GET membership-scoped list, POST organizer frame → `201`); root `/` redirect to `/onboarding` \| `/chats`; ordering by recent chat activity without unbounded message reads. |
| **4. Pre-join preview + member entry + alignment summary** | `2026-09-07-safety-pivot-slice-4-member-entry.md` (write before exec) | New surface in the revised spec (§2.4, §3.3) | Trip-preview + member-entry components; `submit_member_entry` RPC; `trip_alignment_summary` `security definer` aggregate fn; destination-specific candidate-card ratings. Invitation **send/accept UI stays deferred** — the boundary is fixed and the current member (organizer) can fill their own entry. |
| **5. Selected-trip navigation consolidation** | `2026-09-07-safety-pivot-slice-5-nav.md` (write before exec) | Task 7 | Shared Chat/Plan/Timeline shell, Chat default; remove duplicate top-level Timeline/Jigsaw links; redirect legacy `/trips/[tripId]/workspace` into the shell; every screen has a visible route back to the group list. |
| **6. Global defaults in planning + verification** | `2026-09-07-safety-pivot-slice-6-planning-verify.md` (write before exec) | Tasks 8–9 | Constraint gate evaluates each member's active **global** confirmed constraints ∪ trip confirmed constraints via a narrow server projection (no raw cross-member data, social role never exposed); current-trip explicit prefs/expiring signals reweight global soft defaults without overwriting; `docs/implementation-status.md` updated per shipped behavior; full lint/typecheck/test/build + hosted acceptance runbook. |

## Cross-slice self-review checklist (run after each slice)

1. **Spec coverage:** every acceptance criterion in spec §7 maps to a task in some slice —
   redirect before trip UI (2), persist + redirect to `/chats` (2), returning user →
   `/chats` (2/3), empty chat home creates an organizer-framed trip and enters chat (3),
   one trip = one chat history (3), non-member isolation (3), cannot join before frame +
   inputs (4), deterministic backfill without leaking (1), desktop/mobile a11y (2–5).
2. **No stale identifiers:** nothing references `budget_lean`, `pace`, `social_role`,
   `mobility_threshold_m` on `user_travel_profiles`, the `quick`/`full` onboarding modes,
   `walkingCapM`, `SURPRISE_DIAL_DEFAULT` as a submit field, or `create_trip_group(text)`
   after Slice 1.
3. **Type consistency:** `OnboardingAnswers`, `OnboardingSnapshot`, `CreateTripFrameInput`,
   `MemberEntry`, `AlignmentSummary`, `submit_user_onboarding(bigint, jsonb)`,
   `create_trip_group(text, text, date, date, int, text, text, boolean)`,
   `submit_member_entry(uuid, jsonb)` — names/signatures identical everywhere they appear.

## Decisions flagged for the reviewer

- **`trip_mode` vocabulary is invented.** The spec says "a broad trip mode" without values.
  Slice 1 defines `TRIP_MODES = ["relaxed", "balanced", "adventurous", "mixed"]` as a
  Postgres enum `public.trip_mode`. Easy to change; isolated to one enum + one Zod schema.
- **Slice 1 deviations from its sub-plan** (all green, no scope change):
  - Added `lib/domain/onboarding-legacy.ts` — `submitBodySchema` / `OnboardingSnapshot` were
    shared with the still-live trip-scoped compat flow, so the pre-pivot contract was frozen
    in its own module (cleaner than casting). `app/actions/onboarding.ts` and the five-screen
    `components/onboarding-wizard.tsx` repoint to it, no behavior change. Slice 2 replaces the
    wizard outright.
  - `tests/domain/trip-frame.test.ts` folded into the existing `tests/domain/trip.test.ts`
    (repo keeps trip-domain tests in one file).
  - Plan Tasks 3+4+5 landed as one DB commit — the migration-presence assertions in the
    PGlite `beforeAll` hooks couple `202609060004` and `202609060005`.
  - `user_travel_profiles` keeps `backfilled_from_trip_member_id` (added by `202609060003`);
    only the four pre-pivot answer columns drop.
- **Slice 2 deviations from its sub-plan** (all green, no scope change):
  - New `components/user-onboarding-wizard.tsx` rather than mutating the delivered
    five-screen `components/onboarding-wizard.tsx` — the two contracts (safety-only vs the
    frozen trip-scoped shape) can't cleanly share one component, and the compat flow must
    keep working. Mirrors the Slice 1 `onboarding.ts` / `onboarding-legacy.ts` split.
  - `successHref` interim default is `/` (the dashboard). Slice 3 makes it `/chats` and adds
    the completed-user root redirect.
  - Gate middleware cases live in the existing `tests/api/auth.test.ts` harness (it already
    routes `mocks.fetch`); no separate `tests/middleware.test.ts`.
  - `isOnboardingComplete` fails **open** on a DB error (returns `true`) so a transient blip
    can't strand a completed user at `/onboarding`; the submit RPC still CAS-checks.
- **"dates or duration".** Slice 1 accepts either an explicit `startDate`+`endDate` pair
  (≤14 days, the path that can reach `status = 'ready'`) **or** a `plannedDurationDays`
  integer (1–14). Duration-only frames enable chat but stay `draft` until real dates are
  set — consistent with spec §2.3 ("planning and generation … only after the … frame is
  valid") and the existing generation backstop.
- **Invitations remain deferred (spec §8).** Slice 4 builds the fixed boundary — preview,
  `submit_member_entry`, `trip_alignment_summary` — but no working invite send. A
  non-organizer cannot obtain an entry row until the invite flow ships; the acceptance
  criterion "cannot join before frame + inputs" is satisfied structurally (the future join
  RPC will require an entry row first).
- **`traveler_profiles` and the trip-scoped `/api/trips/[tripId]/onboarding` stay intact**
  through Slices 1–5 as the compatibility read path; Slice 6 (or a later cleanup) retires
  them once hosted backfill counts are verified per
  `docs/testing/travel-dna-backfill-runbook.md`.
