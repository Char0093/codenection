# WanderSync

WanderSync is an end-to-end adaptive collaborative travel system for group trips: it extracts hard constraints from group chat, optimizes a budget-bounded itinerary, coordinates split-and-merge routing, and self-heals against weather and budget drift — all inside a native, multi-user collaborative workspace in the browser.

`Implementation_Plan.md` is the binding specification. It supersedes the earlier narrowed "travel planner MVP" scope, including that plan's non-goals for member profiles, allergen data, and weather logic.

**Retired direction:** the Telegram bot and Telegram Mini App are removed from the product. Migration `202609050001_retire_telegram_surface.sql` drops the leftover columns, and `origin/codex/phase-0-1` (Telegram link tokens and webhook) is abandoned rather than merged. The replacement is specified in `docs/features/collaborative-workspace.md`.

**Architecture (hybrid):** Next.js owns the entire user-facing experience — the collaborative workspace (realtime group chat with an embedded AI assistant, plus a draggable flashcard itinerary timeline), Supabase auth/data, Realtime fan-out, and all Gemini calls. There is no bot, webhook, or third-party chat client. A stateless Python/FastAPI service (`services/optimizer/`, Phase 2 onward) owns the operations-research compute — m-VRPTW routing, Knapsack scheduling, clustering, SunCalc, and DAG retopology — over anonymized payloads only.

## Delivered foundation (former Phases 0 and 1)

- Magic-link sign-in and authenticated trip creation, loading, and editing.
- Trip-level destination, dates, budget, pace, and ordinary group notes.
- Gemini structured JSON, Zod validation, deterministic schedule checks, and pending proposal storage.
- Owner-only confirmation or rejection. Confirmation updates the active itinerary atomically.
- Database-enforced trip isolation, revision checks, and per-user/per-trip generation limits.
- No emoji in the frontend.

This is the baseline WanderSync builds on. Extend it; do not re-implement it. Phase 1 of the plan adds constraint extraction and the hard-constraint gate on top.

Local automated tests are available. Live Supabase authentication/RLS and a real Gemini generation must still be verified with a disposable development project; see `tests/database/live-rls.md` and `docs/testing/phase-0-1.md`.

## Run locally

```bash
npm install
copy .env.example .env.local
npm run dev
```

The project-local skills are a pinned submodule. After cloning, run `git submodule update --init --recursive` to populate `superpowers/`.

Set the values in `.env.local` using `.env.example` as the environment contract:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: your development project's public connection settings.
- `GEMINI_API_KEY`: server-only API key. Never prefix this with `NEXT_PUBLIC_`.
- `GEMINI_MODEL`: defaults to `gemini-3.7-flash`; configure a model available to your project.

Apply all SQL migrations in `supabase/migrations/` in filename order to a disposable Supabase project. Use the Supabase CLI with an explicit development project reference (`supabase link --project-ref <development-ref>` then `supabase db push`), or the SQL editor. Do not apply these blindly to a production project. The forward migration preserves old tables but revokes application access to retired profile/provider data.

Enable email sign-in in Supabase Auth. Configure Site URL to the development URL and allow the exact callback URL, for example `http://localhost:3000/auth/callback`. Open the email link in the browser that requested it, since PKCE uses a browser-specific verifier. Use the actual port printed by Next.js if 3000 is occupied.

Without Supabase configuration, the app opens a disabled sign-in screen. It does not fall back to local/demo persistence. No service-role key is needed by the runtime.

**Dev-only password sign-in:** magic-link email is rate-limited on Supabase's default mailer (a few sends per hour), which makes it impractical for repeated local testing. In development builds only (`npm run dev`; this form does not render in a production build), the login page also shows a password field. Seed a user once with the service-role key from Project Settings -> API (never committed, never read from `.env.local`):

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run seed:dev-user -- dev@example.com a-strong-password
```

(PowerShell: `$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"; npm run seed:dev-user -- dev@example.com a-strong-password`)

The npm script loads `NEXT_PUBLIC_SUPABASE_URL` from `.env` automatically (via `node --env-file=.env`); only the service-role key needs to be set for this one command, and it is never written to `.env`/`.env.local`. Then sign in at `/login` with that email and password instead of waiting on a magic link.

## Verification

```bash
npm run lint
npm test
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:browser
git diff --check
```

Vitest includes real PostgreSQL execution through PGlite, with a test Auth schema and roles. Browser tests render the production React components in a separate Vite test harness with mocked HTTP responses; they are not a live Supabase/Gemini end-to-end test.

## Safety boundary

Trips are limited to 1-14 days. Each activity has a date and local start time, must fit the budget tier, and must not overlap or cross midnight. Activity duration is 15-480 minutes; summed daily activity limits are 240/360/480/600 minutes for relaxed/balanced/active/intense pace. Cost tiers are estimates, not a numeric price guarantee.

Gemini receives only the validated trip input. It has no database tools or authority to activate a plan. Failed generation and validation leave the existing active itinerary unchanged. Pending proposals expire after 24 hours. Input changes invalidate old proposals for confirmation but retain the historical active itinerary until a new one is confirmed.

**Sensitive data:** the current code collects no profile fields, and free-text validation still rejects common English-language disclosures. Until Phase 1 lands the typed constraint schema and the hard-constraint gate, do not enter medical, allergy, or religious-profile data here — the storage and consent controls that make it safe do not exist yet.

From Phase 1 onward, dietary, religious-access, and mobility constraints are stored as **typed enum flags only** (never free-text medical histories), are inert until the affected member confirms them, and are enforced by a deterministic gate that no LLM output can clear. See `Implementation_Plan.md` §IX (Data privacy & safety appendix) for the binding requirements.

Activity times are destination-local wall-clock values, not timezone-aware instants. The migration preserves explicit local-date/time columns; legacy timestamp columns use UTC placeholders for compatibility. Any future scheduling or reminder feature must resolve an actual destination timezone first.
