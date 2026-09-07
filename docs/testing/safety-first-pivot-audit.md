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
the 2026-09-07 re-audit opened. The remaining merge blocker is the hosted two-user acceptance
run, which cannot be satisfied locally.

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
4. **Open.** Run the hosted two-user acceptance flow in
   `docs/testing/safety-first-pivot-acceptance.md` after the backfill prerequisite in
   `docs/testing/travel-dna-backfill-runbook.md` is complete.
5. **Open.** Record the hosted result, test accounts/roles used, and any deviations in this
   document before marking the branch merge-ready.

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
| Hosted verification and result | Not run. Requires a hosted Supabase project and two real accounts. |
| Remaining risks or deferred work | `trip_enforced_constraints` has no minimum-member floor by design — the gate must enforce every member's constraint — so in a two-person trip a member can attribute any flag that is not their own to the other member. It is consumed server-side only (filtering, never returned raw), but the same caveat as the aggregate threshold applies. Hosted two-user acceptance (gate items 4-5) is still open and is the sole remaining merge blocker. The two-entry aggregate floor remains a product decision, not a privacy guarantee. `202609060004` was edited in place; once applied to a deployment environment, all further changes must be forward migrations. |
