# Program audit — 2026-09-07

## Purpose

Records a code audit of the working tree on `feat/travel-dna-safety-pivot` (2026-09-07,
after the safety-first pivot's hosted acceptance run) and its resolution. Scope: assistant
authorization, chat abuse resistance, dependency security, and transport-layer hardening.
Distinct from `docs/testing/safety-first-pivot-audit.md`, which covers the Travel DNA /
member-entry / constraint-enforcement surface.

## Findings and resolution

| Priority | Finding | Resolution | State |
| --- | --- | --- | --- |
| P1 | `app/actions/assistant.ts` let any trip member call the assistant, then called `reserve_generation`, whose SQL requires `public.can_manage_trip` (owner/planner only) — correctly and deliberately, for full itinerary generation (see the "rejects unauthorized users" test in `tests/database/migrations.test.ts`, which must keep failing an ordinary member calling `reserve_generation`). Reusing that RPC made the assistant silently fail for every ordinary member. | Added a separate `reserve_assistant_prompt(uuid)` RPC (`202609070001`): membership-gated (`is_trip_member`, not `can_manage_trip`), no `status = 'ready'` requirement (chat/assistant is usable on a draft trip), backed by its own `assistant_reservations` table so a member's assistant usage never shares a quota with the owner/planner-only generation gate. `app/actions/assistant.ts` now calls the new RPC. | Resolved (`202609070001`, `app/actions/assistant.ts`) |
| P2 | `lib/chat/repository.ts`'s `sendMessage` posts directly to `chat_messages` via PostgREST from the browser — there is no server action in that path, so no application-code rate limit was possible. A member could script repeated direct inserts to spam a trip and crowd out the bounded 20-message window `askTripAssistant` reads as model context. | A `before insert` trigger on `chat_messages` (`_chat_messages_rate_limit`) caps a member to 15 inserts per 30 seconds, scoped by `author_member_id` (which already uniquely identifies one trip+user pair). Enforced at the table, so it applies regardless of insert path. New `P0004` SQLSTATE mapped in `lib/http/errors.ts` to a 429 with a chat-specific message, distinct from the existing `P0003` generation/assistant rate-limit message. | Resolved (`202609070001`, `lib/http/errors.ts`) |
| P2 | No Content-Security-Policy was configured; `next.config.ts` set only the other security headers. | Added a CSP: `default-src`, `base-uri`, `object-src`, `frame-ancestors` (all requested) plus `frame-src 'none'`, `form-action 'self'`, and scoped `img-src`/`font-src`/`connect-src` (the last built dynamically from `NEXT_PUBLIC_SUPABASE_URL`, covering both the https REST origin and the wss Realtime origin). `script-src`/`style-src` keep `'unsafe-inline'` (Next's own hydration scripts; 9 components position elements via inline `style={{}}`); `script-src` also carries `'unsafe-eval'` in non-production only, confirmed necessary by triggering an actual CSP violation against `next dev`'s webpack eval-based bundling, and confirmed *unnecessary* in production via a clean `next build && next start`. | Resolved (`next.config.ts`) |
| P2 | `npm audit` reports one high-severity PostCSS vulnerability (XSS via unescaped `</style>` in stringify output; arbitrary `.map` file read via `sourceMappingURL`) transitively through `next@15.5.25`. `npm audit fix --force` would jump to Next 16, a breaking change. | Confirmed directly: 15.5.25 is the latest published 15.x release, and the fix lands only at Next 16.3.4 — no non-breaking upgrade path exists today. The vulnerability is exercised through PostCSS's parser/stringifier at *build* time; nothing in this app runs user-controlled CSS through PostCSS at runtime, so real-world exposure is low despite the "high" advisory severity. **Deferred by explicit decision** (2026-09-07): revisit when Next 16 has matured, or when another feature need forces the major-version upgrade. Not a merge blocker for this branch. | Deferred (accepted risk) |
| P2 (re-audit, 2026-09-08) | The chat rate-limit trigger's `select count(*)` then compare was a plain check-then-act: under READ COMMITTED, N concurrent inserts for the same member each read the same pre-insert count (none see each other's still-uncommitted rows) and can all pass the `>= 15` check together, exceeding the limit. | Serialized per `author_member_id` with `pg_advisory_xact_lock(hashtextextended('chat_messages:member:' \|\| ..., 0))` before counting — the same pattern `reserve_generation`/`reserve_assistant_prompt` already use. Verified against **real concurrent connections** on the hosted project (PGlite could not be used — see below): 10 genuinely concurrent inserts for a member sitting at 14 prior messages resulted in exactly 1 success and 9 correctly rate-limited. | Resolved (`202609070001`) |

## Regression coverage added

- `tests/database/migrations.test.ts` — `describe("assistant prompt reservations")`: an
  ordinary member and a viewer can reserve (unlike `reserve_generation`); a non-member and an
  unauthenticated caller are rejected; a draft trip works (contrasted directly against
  `reserve_generation` refusing the same trip); the trip-level rate limit trips at 5 within
  10 minutes, independent of the generation quota; anon/service-role execution is denied.
- `tests/database/migrations.test.ts` — `describe("trip chat")` gained a case proving the
  30-second/15-message trigger blocks a 16th rapid insert from one member, does not block a
  different member on the same trip, and releases once the window rolls off.
- `tests/api/assistant-action.test.ts` — updated to assert `reserve_assistant_prompt` (not
  `reserve_generation`) is the RPC called, and that its own rate-limit error still maps to 429.
- `tests/lib/http-errors.test.ts` (new) — direct coverage of the `databaseError` SQLSTATE
  table, including the new `P0004` case and that it reads distinctly from `P0003`.
- `tests/lib/next-config-csp.test.ts` (new) — the CSP contains the required directives, denies
  framing via the legacy header too, scopes `connect-src` to the configured Supabase project
  (both schemes), and degrades to `'self'`-only without throwing when Supabase is unconfigured
  or the URL is malformed.

## Local verification

`git diff --check`, `npm run lint`, `npm run typecheck`, `npm test` (957 passing, up from 942),
`npm run build` all green. The CSP was additionally verified live: a real CSP violation was
triggered and diagnosed (webpack's dev-mode `eval()` usage), fixed, and re-verified across
login, onboarding (inline-style progress bar/segmented toggle), a real chat send, and the
Plan/timeline view (heaviest inline-style surface) with zero console errors — using a
throwaway hosted account, deleted afterward. Production behavior (no `'unsafe-eval'`) was
separately confirmed via a clean `next build && next start`, cross-checked against an
unmodified baseline build to rule out an unrelated `.next` cache artifact before concluding
the conditional was correct.

## Re-audit — 2026-09-08: the chat rate limit was raceable

A second pass found that the chat rate-limit trigger's `select count(*)` followed by a
`>= 15` comparison was a textbook check-then-act race: under Postgres's default READ
COMMITTED isolation, each of several concurrent transactions inserting for the *same* member
takes its own count *before* any of them have committed, so none of them see each other's
still-in-flight rows. A burst of concurrent direct-PostgREST inserts could all read the same
"14 so far" and all pass, blowing well past the intended 15-message ceiling — precisely the
kind of gap the limit exists to close.

**Fix:** the trigger now takes `pg_advisory_xact_lock(hashtextextended('chat_messages:member:'
|| author_member_id, 0))` before counting, serializing concurrent inserts for one member so
each one's count reflects every prior insert that is still ahead of it in the queue, not just
what happened to already be committed when its own snapshot was taken. This is the identical
pattern `reserve_generation` and `reserve_assistant_prompt` already use for their own quotas.

**Why there is no PGlite regression test for this:** a genuine attempt was made, and it failed
for a fundamental reason rather than lack of effort. Two independent experiments against a
single `PGlite` instance proved conclusively that "concurrent" `.query()` calls share **one**
underlying session, not isolated connections:

1. `pg_backend_pid()` returned the identical value (`42`) from both "concurrent" branches.
2. Decisively: transaction "A" inserted a row and stayed open (uncommitted) while transaction
   "B" ran `select count(*)` — and B saw A's row. Under real Postgres isolation this is
   impossible; two genuinely separate READ COMMITTED transactions can never see each other's
   uncommitted writes. The only explanation is that "A" and "B" were never separate
   transactions at all — they were cooperatively interleaved statements on one shared session.

A test built on that foundation would not exercise the race either before or after the fix;
it would pass regardless of whether the advisory lock was present, which is worse than no
test — false assurance rather than none. This is the same boundary
`docs/testing/safety-first-pivot-audit.md` already draws for RLS/session/multi-user claims
("Local PGlite tests establish fast regression coverage; hosted Supabase/PostgREST tests
remain required...") extended to genuine cross-connection concurrency claims.

**What was done instead:** the fixed migration was applied to the hosted project, then
verified with *real* concurrent connections — 10 simultaneous HTTPS requests to the
`chat_messages` PostgREST endpoint (each request gets its own independent Postgres
transaction via PostgREST's connection pool, unlike PGlite) for a member sitting at 14 prior
messages. Result: exactly 1 succeeded (bringing the count to 15) and the other 9 were
rejected with `P0004`, with zero unexpected errors. The throwaway account, trip, and messages
used for the check were deleted afterward; zero leftover rows confirmed.

## Hosted application status

`202609070001_assistant_and_chat_rate_limits.sql` (including the 2026-09-08 lock fix) is
**applied to the hosted project** as of this record, verified via direct catalog queries
(`reserve_assistant_prompt`, `assistant_reservations`, and the `chat_messages_rate_limit`
trigger all present; the trigger function's body confirmed to contain
`pg_advisory_xact_lock`) and the concurrent-write check above.
