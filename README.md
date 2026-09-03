# Adaptive Group Travel Planner

Waypoint is a focused trip planner with authenticated Supabase storage and server-side Gemini itinerary proposals. The web app contains Trip Setup and Plan views. Telegram coordination, split/merge, expenses, and offline exports remain later phases.

## Phases 0 and 1

- Magic-link sign-in and authenticated trip creation, loading, and editing.
- Trip-level destination, dates, budget, pace, and ordinary group notes.
- Gemini structured JSON, Zod validation, deterministic schedule checks, and pending proposal storage.
- Owner-only confirmation or rejection. Confirmation updates the active itinerary atomically.
- Database-enforced trip isolation, revision checks, and per-user/per-trip generation limits.
- No People, profile editor, consent toggles, provider dashboard, or dedicated weather/Plan B controls. No emoji in the frontend.

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

Do not enter medical, disability, severe-allergy, or individual religious-profile data. No profile fields are collected. Free-text validation rejects common English-language disclosures, but it is a heuristic, not a comprehensive sensitive-data classifier. Restrict access to development data accordingly.

Activity times are destination-local wall-clock values, not timezone-aware instants. The migration preserves explicit local-date/time columns; legacy timestamp columns use UTC placeholders for compatibility. Future Telegram scheduling must resolve an actual destination timezone first.
