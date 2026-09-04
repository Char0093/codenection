# Phase 0 and 1 Verification

## Scope and Decisions

- Work is on `codex/phase-0-1` in the existing checkout, preserving the user's implementation-plan edits and local Superpowers folder.
- Activity `date` extends the draft Gemini contract because multi-day validation requires a date per item.
- Owner and planner can edit trip inputs and generate proposals. Only the actual trip owner can confirm or reject them, matching the phase 1 UI requirement.
- Maximum trip duration is 14 days. Daily activity duration caps are 240/360/480/600 minutes by increasing pace; budget validation compares tiers, not monetary totals.
- Authentication uses verified Supabase users and cookie sessions. Runtime queries use the public key plus user JWT and RLS, never a service-role bypass.
- SQL save and decision RPCs revalidate every payload and lock the trip. A revision prevents stale approvals after edits or confirmed preference changes.
- Earlier migrations remain unchanged. The new migration preserves historical retired tables while revoking application access.
- Local tests use an in-memory PostgreSQL engine and isolated browser fixtures. No runtime demo mode or authentication bypass was added.

## Automated Evidence

Baseline: `npm test -- tests/domain` passed 13 existing tests before implementation.

Repository/API tests cover authenticated creation and reads, owner/planner edits, unrelated-account denial, extra input fields, HTTP origins, body size, callback redirect boundaries, provider errors, throttling, and preservation of active state.

Gemini tests use an injected fake client to cover structured output, malformed JSON, missing fields, unsupported categories, invalid calendar dates/times, schedule overlap, budget and pace limits, provider failure, rate limits, and timeout cancellation.

Database tests apply all migrations to PGlite with test roles and an Auth schema. They exercise SQL permissions and transactions rather than claiming mocked repository tests prove RLS. The harness omits only `create extension pgcrypto`, since PGlite already supplies UUID generation and does not ship that extension. See `tests/database/live-rls.md` for the hosted verification boundary.

UI tests cover setup, pending review, loading, validation errors, generation failure, owner-only decisions, persistence/reload, and the absence of aborted surfaces. Playwright uses production components with mocked API responses at desktop and mobile sizes.

Recorded verification (rerun on 2026-09-04 against commit `488090c`):

- Full Vitest suite via `npm run test:coverage`: 325 tests passed across 15 files, including 76 PostgreSQL tests and 40 Auth/session tests. No tests failed or were skipped.
- `npm run lint`: passed.
- Domain coverage: 100% lines/functions/statements and 97.05% branches. These percentages apply to `lib/domain`, the configured coverage scope, not the entire application.
- `npm run build`: passed on the final implementation, with `/` and `/login` dynamically rendered.
- `npm run test:browser`: all four desktop/mobile tests passed on the final implementation. These use the isolated React harness with mocked API responses.
- Production smoke: started the built Next.js app at `http://127.0.0.1:3100`, verified the root renders the disabled login state when unconfigured, unconfigured API's 503 `NOT_CONFIGURED`, missing callback code redirect, and cross-origin POST's 403 rejection. Real Chromium verified disabled sign-in, no page errors, and no horizontal overflow at 1440x1000 and 390x844. Screenshots are in ignored `test-results/production-login-*.png`; the mobile screenshot was visually inspected. The temporary server was stopped after testing. Later mock-account browser QA also verified that local `127.0.0.1` root navigation keeps the same host instead of redirecting to `localhost`.
- `git diff --check`: passed; Git reported only Windows LF-to-CRLF conversion notices.

Review fixes cover legacy-row repair, Auth outages without unintended cookie deletion, failed sign-out handling, hidden legacy sensitive outputs, SQL/JavaScript whitespace parity, unavailable-trip navigation, and reconciliation after conflicting or uncertain decisions.

The local Superpowers repository is tracked as a pinned Git submodule. New checkouts should run `git submodule update --init --recursive` to fetch it.

## Live Service Gate

Rechecked on 2026-09-04: this checkout has only `.env.example`, and no Supabase URL, Supabase public key, or Gemini API key is configured in the process environment. Docker Desktop is installed but its engine is not running. No hosted project was created or modified, no live Gemini request was sent, and no email sign-in was verified.

Before marking either phase's live exit criteria complete:

1. Configure a disposable Supabase project and apply all migrations.
2. Complete the role matrix in `tests/database/live-rls.md` using owner, planner, member, viewer, and unrelated users.
3. Set the server-only Gemini key and an available model. Sign in, create a trip, reload it, and generate a real proposal.
4. Confirm and reload the active itinerary. Generate a second proposal and reject it; verify the first remains active.
5. Edit a trip after generation and verify stale confirmation fails. Simulate a provider error and check that the active itinerary survives.

The code and local verification can be delivered independently of these credentials; the hosted acceptance gate remains explicitly open.

## References

- [Supabase SSR clients and session handling](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase verified user lookup](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini 3.7 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)
