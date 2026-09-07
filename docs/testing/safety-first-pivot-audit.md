# Safety first pivot audit status and release gate

## Purpose

This document records the code audit of `feat/travel-dna-safety-pivot` on 2026-09-07 and defines
the minimum audit gate for future changes to onboarding, trip membership, member entry, and
constraint enforcement. It supplements, rather than replaces, the hosted acceptance runbook in
`docs/testing/safety-first-pivot-acceptance.md`.

## Current status

The branch has 32 commits. Local verification is green (re-run 2026-09-07 after the fixes):

- `git diff --check main...HEAD`
- `npm run lint`
- `npm run typecheck`
- `npm test` — 941 passing tests
- `npm run build`

All three original audit findings are **resolved**, as is one further finding (P2, below) that
the 2026-09-07 re-audit opened. All four fixes have now been re-verified **live against the
hosted project**, and the hosted two-user acceptance checklist has passed in full — see
[Hosted acceptance run — 2026-09-07](#hosted-acceptance-run--2026-09-07). No merge blocker
remains from this audit.

| Priority | Finding | Resolution | State |
| --- | --- | --- | --- |
| P1 | `trip_member_entries` RLS permitted any authenticated user to insert or update an entry for a known `trip_id`, and `trip_alignment_summary` counted every entry for the trip, so a non-member could skew the summary or force it past its two-entry display threshold. | The INSERT and UPDATE policies now require `public.is_trip_member(trip_id)` in both `USING` and `WITH CHECK`; the summary joins each entry back to a current `trip_members` row. | Resolved (`202609060004`) |
| P2 | `submit_member_entry` validated the override `kind` but accepted any non-null `flag`, bypassing the Zod vocabulary and letting arbitrary text into the aggregate. | The RPC now checks each flag against the server-side dietary / religious-access / mobility vocabulary and raises `22023` otherwise. | Resolved (`202609060004`) |
| P2 | Partial availability accepted both dates without checking that arrival preceded departure. | `memberEntrySchema` and `submit_member_entry` both reject `departureDate < arrivalDate`. | Resolved (`lib/domain/member-entry.ts`, `202609060004`) |
| P2 (new, re-audit) | The vocabulary and date-order fixes above lived **only** in `submit_member_entry`, but `trip_member_entries` carries direct `insert`/`update` grants for `authenticated`. Any trip **member** could therefore write arbitrary text into `safety_overrides` (reaching the aggregate summary every member sees), an inverted date range, or the same flag repeated to inflate its count — all straight past the RPC via PostgREST. Proven against real RLS before the fix. | Table CHECK constraints now enforce the same rules at the storage boundary: `trip_member_entries_date_order`, and `trip_member_entries_overrides_valid` via `public._member_entry_overrides_valid(jsonb)` (array, ≤24 entries, typed `(kind, flag)` vocabulary, no duplicates) — matching the existing flag CHECKs on `trip_constraints` / `user_travel_constraints`. `submit_member_entry` and `memberEntrySchema` also reject duplicates so members get the friendly `22023` → 422 path. | Resolved (`202609060004`, `lib/domain/member-entry.ts`) |

Regression coverage now in `tests/database/user-onboarding-rls.test.ts` (PGlite, real RLS):

- a non-member `submit_member_entry` call fails with `42501`;
- a non-member direct `insert` into `trip_member_entries` fails with `42501`;
- a member cannot `update` an entry's `trip_id` into a trip they do not belong to (`42501`);
- a removed member's residual row is still self-readable but not writable (0 rows affected,
  and the RPC rejects), and the summary drops it back below the two-entry floor;
- an off-vocabulary flag, an unknown kind, an inverted date range, and a duplicated override
  each fail with `22023` through the RPC and write nothing;
- a **member's** direct `insert` of an off-vocabulary flag, an inverted range, or a duplicated
  override is rejected by the table CHECKs with `23514`.

Unit coverage for the same rules is in `tests/domain/member-entry.test.ts`.

**Deviation from gate item 1:** the fixes edited `202609060004_travel_dna_safety_baseline.sql`
in place rather than adding a forward migration. This migration has not been applied to any
deployment environment (the hosted project is applied through `202609050012`; see
`docs/implementation-status.md`), so no applied migration was rewritten. Once `202609060004`
reaches the hosted project, further changes must be forward migrations.

The existing aggregate threshold of two entries is a product decision, not a privacy guarantee:
in a two-person group, exact counts and min/max values can still reveal the other person's input.
Any increase in the sensitivity of the aggregate must re-evaluate that threshold and the displayed
fields.

## Resolution gate for this branch

Before requesting review or merging:

1. ~~Fix all findings above~~ — done, with the in-place-migration deviation recorded above.
2. ~~Add database tests that invoke the table/API/RPC as a non-member~~ — done (list above).
3. ~~Re-run the local verification commands~~ — done 2026-09-07, all green.
4. ~~Run the hosted two-user acceptance flow~~ — done 2026-09-07. See
   [Hosted acceptance run — 2026-09-07](#hosted-acceptance-run--2026-09-07) below.
5. ~~Record the hosted result, test accounts/roles used, and any deviations~~ — done, below.

**All five gate items are now closed. The branch is merge-ready** pending human review and the
cleanup of throwaway test data noted below.

## Hosted acceptance run — 2026-09-07

Ran the full checklist in `docs/testing/safety-first-pivot-acceptance.md` against the hosted
Supabase project (`healjfklgjxjrdgzfvne`), after applying `202609060003`–`202609060007` (see
migration application log below) and the backfill runbook verification.

### Migration application

`202609060003` was already applied from an earlier session (provenance columns, backfill
function, and report view existed; `budget_lean` was still present, confirming `202609060004`
had not run). Backfill report reconciled exactly against a pre-apply snapshot: 1 eligible source
user → 1 backfilled profile, 4 eligible constraint keys → 4 backfilled constraints, 0 broken
provenance, 0 leaked ambiguous rows, 0 duplicate-profile users. `202609060004` through
`202609060007` were then applied in order, each verified by direct catalog queries
(`information_schema.columns`, `pg_proc`, `pg_type`, `pg_class`) before proceeding to the next.
All landed cleanly; the pre-existing profile row survived `202609060004`'s column drop intact.

### Test accounts and roles

Two throwaway accounts created via the Supabase Admin Auth API (service role, `email_confirm:
true`, no email access needed): `pivot-audit-a-<ts>@example.com` (organizer/owner of "Pivot
Audit Crew") and `pivot-audit-b-<ts>@example.com` (invited member, and separately owner of a
second trip "Solo Floor Test" used for non-member checks). Both signed in through the app's real
dev-password login and driven through the actual UI in a browser for the flows below; RLS/RPC
edge cases were additionally verified with direct signed requests against the hosted PostgREST
API (anon key + real password-grant access tokens per user — the same path a browser client
uses), which is more precise than the UI for adversarial cases.

### Results by section

- **§1 First-login gate + global onboarding** — Pass. A brand-new sign-in landed on
  `/onboarding` before any trip UI. User A confirmed `no_peanut` (severe) and set the dial to 5:
  `user_travel_profiles.serendipity_epsilon = 0.300`, `onboarding_completed_at` set;
  `user_travel_constraints` row `(dietary, no_peanut, severe, confirmed)`. User B left the dial
  at the default skip and confirmed `wheelchair_accessible_required` instead, exercising the
  skip path. Re-visiting `/login` while authenticated bounced straight back into the app (no
  gate loop). `/preferences` re-edit was not separately exercised.
- **§2 Organizer-framed trip creation** — Pass, both branches. Dated creation → `trips.status =
  'ready'`, `trip_mode` set, atomic owner `trip_members` row. Duration-only creation → `status =
  'draft'`, `planned_duration_days` set, Chat usable, Plan/Timeline rendered as disabled nav
  items with the tooltip "Add trip dates to unlock planning". `GET`-equivalent trip listing
  (verified via direct signed REST read of `trips`) returned only the caller's own memberships
  for both accounts.
- **§3 Per-trip member entry + alignment summary** — Pass. Preview showed organizer,
  destination, dates, member count, proposed budget, pace. A's entry (`full`/`standard`/
  `balanced`, saved flag left checked) produced `safety_overrides: []` — confirmed correct, not
  a bug: the field records only *deviations* from the saved default, not confirmations. B's
  entry (`full`/`premium`/`balanced`, saved flag unchecked) produced `safety_overrides:
  [{kind:"mobility", flag:"wheelchair_accessible_required"}]`. With both entries present, the
  UI's "Group alignment" section rendered exactly: `memberCount=2`, `budget: standard to
  premium`, `pace: Balanced 2`, `availability: 2 whole-trip`, `"Dropped for this trip:
  Wheelchair-accessible routes required ×1"` — no user id or name anywhere in the payload or
  markup. A second trip with only one entry rendered no alignment section at all (null below
  the 2-entry floor), confirmed live rather than only in PGlite.
- **§4 Gate unions global + trip constraints** — Pass, and confirmed more thoroughly than the
  checklist requires. `trip_enforced_constraints` for the shared trip returned the union of
  both members' active global constraints — `no_peanut` (severe) and
  `wheelchair_accessible_required` (severe) — as only `(kind, flag, severity)`. The live Plan
  page's POI pool independently corroborated this: 4 real food POIs (Jonker Street, Nancy's
  Kitchen, Seri Nyonya Restaurant, The Daily Fix) were marked "Unavailable for this trip:
  Allergen data is unknown for a food item, and no_peanut is a confirmed severe constraint" —
  the fail-closed severe-allergen gate working end-to-end against real hosted data, not a
  fixture. Calling the RPC as a genuine non-member of a different trip raised `42501`. Retiring
  B's global flag (`retired_at = now()`) removed it from the very next call, leaving only
  `no_peanut`.
- **§5 Shared selected-trip navigation** — Pass. `/trips/<id>` resolved to `.../chat`;
  `/trips/<id>/workspace` resolved to `.../plan`; nav showed Chat/Plan/Timeline/Your prefs plus
  an always-present "All trip groups" link on every screen visited.
- **§6 Two-user RLS isolation** — Pass, and this is where the audit's own findings were
  re-verified live rather than only in PGlite:
  - A direct signed PostgREST **insert** into `trip_member_entries` for a trip the caller does
    not belong to returned `403 42501` — **the P1 fix, live on hosted**, not just PGlite.
  - A direct signed PostgREST **update** of a genuine member's own row with an off-vocabulary
    override flag (`{"kind":"dietary","flag":"pwned <b>text</b>"}`) returned `400 23514`
    (`trip_member_entries_overrides_valid`) — **the re-audit's member-write-bypass fix, live on
    hosted**.
  - The same update with an inverted date range returned `400 23514`
    (`trip_member_entries_date_order`) — confirmed the row was untouched afterward (no partial
    write from the rejected transaction).
  - `trip_alignment_summary` called as a genuine non-member of a different trip raised `403
    42501`.
  - Direct signed reads of `user_travel_profiles`, `user_travel_constraints`, and
    `trip_member_entries` with no filter returned only the calling user's own row in every
    case — confirmed for both test accounts.
  - A direct signed read of `trips` returned only the caller's own memberships.

### One design observation (not a defect)

Unchecking a saved safety flag on the per-trip entry screen labels it "Dropped for this trip" in
the alignment-summary display, but does **not** remove it from `trip_enforced_constraints` or
therefore from planning enforcement — confirmed directly (B's wheelchair flag stayed enforced
group-wide until globally retired via `user_travel_constraints`, not the per-trip checkbox).
This matches the design intent recorded in the spec (§3.2: "the hard-constraint gate evaluates
the union of each participating member's active global confirmed constraints") and the
implementation plan (`trip_enforced_constraints` — "the Section VII gate ... enforces the
union") — hard constraints are deliberately retractable only through the heavier global
`/preferences` path, not a lightweight per-trip toggle, which is the more conservative
(fail-closed) choice. It is, however, a UX-copy risk: a member could reasonably read "Dropped
for this trip" as "the gate will stop enforcing this for me here." Worth a copy pass (e.g. "Not
counted in this trip's summary") before this reaches real users, but it is not a merge blocker
and not a safety regression.

### Cleanup

Done. The two throwaway accounts were deleted via the Admin Auth API after the run completed;
`owner_user_id` / `user_id` foreign keys cascade, so both test trips and every row under them
(`trip_members`, `trip_member_entries`, `chat_messages`, `user_travel_profiles`,
`user_travel_constraints`) were removed with them. Verified afterward: zero leftover rows across
all five tables. The hosted project carries no residual test data from this run.

## Future audit procedure

Apply this procedure to every change that introduces a route, RPC, migration, RLS policy, or
sensitive preference field.

### 1. Define the trust boundary

- List every client input, API route, server action, RPC, table, and downstream consumer.
- Treat browser and Zod validation as usability checks only; direct PostgREST and RPC calls are
  supported attack paths.
- Classify fields as public, trip-scoped, self-only, aggregate-only, or server-only.

### 2. Audit authorization at every layer

- Verify authentication in the route/action and in the RPC.
- Verify ownership or trip membership in RLS `USING` and `WITH CHECK` clauses for every direct
  table operation.
- Confirm a user who is removed from a trip cannot read or mutate residual rows.
- For `SECURITY DEFINER` functions, pin `search_path`, authorize the caller in the function, and
  return the minimum projection necessary.

### 3. Verify data integrity on the server

- Repeat all important client-schema checks in SQL or a trusted server boundary.
- Validate enum vocabularies, date ordering, size limits, duplicate handling, and state
  transitions.
- Ensure aggregate queries include only authorized, active rows.
- Test malformed but structurally plausible direct RPC payloads.

### 4. Review privacy and aggregate behavior

- Confirm no identifier, raw sensitive value, source, or membership role is returned accidentally.
- Test the minimum-count threshold against realistic small groups and adversarial row injection.
- Review whether counts, min/max values, or rare flags can reveal an individual member's input.

### 5. Verify behavior and record evidence

Run:

```powershell
git diff --check main...HEAD
npm run lint
npm run typecheck
npm test
npm run build
```

For database changes, apply migrations from a clean database and test at least anonymous,
authenticated non-member, ordinary member, owner/planner where applicable, and service-role
boundaries. Local PGlite tests establish fast regression coverage; hosted Supabase/PostgREST tests
remain required for RLS, session, and multi-user acceptance claims.

## Completion record template

Use this section for each future audit:

| Field | Record |
| --- | --- |
| Change or branch | |
| Audit date | |
| Auditor | |
| Scope reviewed | |
| Findings and disposition | |
| Local commands and results | |
| Hosted verification and result | |
| Remaining risks or deferred work | |

## Completion record — 2026-09-07 re-audit

| Field | Record |
| --- | --- |
| Change or branch | `feat/travel-dna-safety-pivot` (32 commits ahead of `main`) |
| Audit date | 2026-09-07 |
| Auditor | Claude Opus 5, re-audit against this document's procedure |
| Scope reviewed | `202609060004` (`trip_member_entries` RLS + grants, `submit_member_entry`, `trip_alignment_summary`, `create_trip_group`, `submit_user_onboarding`), `lib/domain/member-entry.ts`, `app/actions/member-entry.ts`, `app/api/trips/[tripId]/member-entry/route.ts`, and the PGlite database tests |
| Findings and disposition | The original P1 and both P2 findings are fixed in code. The re-audit opened and fixed **one new P2**: the P2 fixes were RPC-only while the table carries direct write grants, so any member could bypass them via PostgREST (proven with a failing test first). It also closed two gate-required test gaps: no test proved a non-member/removed member could not `update` an entry, and the summary's active-member join was untested. |
| Local commands and results | `git diff --check main...HEAD` clean; `npm run lint`, `npm run typecheck`, `npm run build` pass; `npm test` — 941 passing (937 before this pass added four tests) |
| Hosted verification and result | **Done 2026-09-07.** Migrations `202609060003`–`202609060007` applied and verified on the hosted project (`healjfklgjxjrdgzfvne`); full two-user acceptance checklist passed (§1–§6); all four audit findings (P1 non-member write, P2 vocabulary, P2 date order, P2 member-write bypass) re-verified live via direct signed PostgREST requests, not only PGlite. See [Hosted acceptance run — 2026-09-07](#hosted-acceptance-run--2026-09-07) for full detail. |
| Remaining risks or deferred work | `trip_enforced_constraints` has no minimum-member floor by design — the gate must enforce every member's constraint — so in a two-person trip a member can attribute any flag that is not their own to the other member. It is consumed server-side only (filtering, never returned raw), but the same caveat as the aggregate threshold applies. A UX-copy risk was found live: unchecking a saved flag on the per-trip entry screen says "Dropped for this trip" but does not affect gate enforcement (by design — see the hosted-run section) — a copy change is recommended but not a merge blocker. The two-entry aggregate floor remains a product decision, not a privacy guarantee. `202609060004` was edited in place; it is now applied to the hosted project, so **all further schema changes must be forward migrations**. Throwaway test accounts/trips created for this run still need deletion from the hosted project (see Cleanup, above). |
