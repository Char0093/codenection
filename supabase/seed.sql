-- Implementation_Plan.md Task 1.1: runs automatically after migrations on `supabase db reset` /
-- `supabase start` (local dev only -- this file is never applied to a hosted project). Shells out
-- to the idempotent TypeScript seeder rather than inlining hand-written INSERTs, so the same
-- upsert logic and Zod validation run whether triggered here or via `npm run seed:kl-reference`
-- directly against a hosted project.
--
-- Requires SUPABASE_SERVICE_ROLE_KEY in the environment (never committed); skips quietly if unset
-- so a bare `supabase db reset` without that variable does not fail a fresh checkout.
\if :{?SUPABASE_SERVICE_ROLE_KEY}
  \! npx tsx scripts/seed_kl_reference.ts
\else
  \warn 'SUPABASE_SERVICE_ROLE_KEY not set -- skipping the reference POI seed (npm run seed:kl-reference to run it manually).'
\endif
