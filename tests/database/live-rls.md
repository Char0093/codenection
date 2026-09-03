# Database Verification and RPC Contract

## Actual Evidence

Local PGlite evidence was recorded on 2026-09-03. Hosted verification was added on 2026-09-04 against an authorized disposable Supabase project; no credentials, real user data, or profile data were printed or retained.

Hosted commands executed from the repository:

```powershell
npm exec --yes --package supabase@2.116.0 supabase -- db push --linked
npm exec --yes --package supabase@2.116.0 supabase -- db query --linked --file tests/database/live-rls.sql
npm exec --yes --package supabase@2.116.0 supabase -- db push --linked --dry-run
```

All four forward migrations applied and the final dry run reported the remote database up to date. The rollback-only SQL matrix passed with authenticated owner, planner, member, and unrelated roles. It verifies owner `INSERT ... RETURNING`, planner trip/preference writes, member reads with no trip update, direct proposal-write denial, and unrelated read/update isolation. Fixture users are created inside the transaction and the follow-up count was zero after rollback. Membership fixture setup runs as the privileged test connection because ordinary membership writes are intentionally server-only.

Command executed from `C:\Codenection`:

```powershell
npx vitest run tests/database/migrations.test.ts
```

Final result after the legacy-read and whitespace review fixes: **1 test file passed, 76 tests passed**, 3.38 seconds (Vitest 3.2.7, start 17:32:03 local time). `npx eslint tests/database/migrations.test.ts` also passed.

The test-first run failed because `202609030004_narrow_trip_scope.sql` did not exist. Subsequent tests for the narrower text bounds and direct trip input bounds also failed before those SQL checks were added. The final run passed with all changes applied.

The review regressions were also run before their fixes: 26 failed and the original 47 passed. These failures reproduced legacy payload/day/item visibility, sensitive-column SELECT access, missing provenance checks, and ASCII/Unicode whitespace-only values passing save and acceptance. All now pass, alongside three additional tests for mixed legacy/new rows, exact JavaScript whitespace parity and trimmed upper bounds.

The harness executes every actual SQL migration in filename order. It stubs `auth.users`, `auth.uid()`, `auth.jwt()`, and the `anon`, `authenticated`, and `service_role` roles. `service_role` has `BYPASSRLS`. Deliberately broad default table grants model the grants that the forward migration must remove. The only migration-text substitution removes `create extension if not exists pgcrypto;` in memory because PGlite already supplies `gen_random_uuid()` but does not supply this extension. No committed migration is rewritten.

The suite executes PostgreSQL policies, privileges, triggers, constraints, and RPCs. It verifies:

- Owner/planner/member/viewer reads, unrelated-user isolation, nonrecursive membership RLS, authenticated self-owned creation, and exact trip input column grants.
- Owner/planner edits, revision increments, no-op update stability, and denial of ownership, membership, revision, or active-proposal forgery.
- Revocation of all retired-table privileges for client and service roles. Historical sentinel rows in all five retired tables survive migration; a preexisting 30-day trip also survives the new `NOT VALID` checks.
- Pre-migration profile-bearing proposal payloads, itinerary day summaries and item conflicts survive unchanged but are hidden from viewers. A legacy proposal using the `gemini_itinerary` type without new validation metadata is also hidden.
- Proposal validation markers, accepted status and same-trip links control itinerary reads. Legacy/pending items sharing a readable day remain hidden. Both decisions reject unsupported legacy rows rather than returning their payload through the RPC.
- Explicit itinerary item column grants deny `safety_conflicts`, `destination_id`, and `SELECT *`, including for owner/planner users.
- Direct proposal/itinerary/reservation mutation denial, including service-role access; PUBLIC function execution is revoked.
- Confirmed ordinary preference permissions and revision invalidation.
- Proposal shape, required date, real calendar dates, full day coverage, 14-day maximum, time, integer duration, category, budget tier ceiling, all four pace caps, overlap and midnight bounds.
- Server-attributed pending saves, model identifier, trip revision, exact 24-hour expiry, and error SQLSTATEs.
- JavaScript-compatible whitespace trimming for text validation, including tabs, line separators, Unicode spaces and BOM. Direct save and acceptance revalidation reject whitespace-only summary/title/rationale/assumptions/contingency text. Trip destination, model identifier and preference checks use the same trimming semantics.
- Owner-only activation, revalidation after privileged payload tampering, stale/expired/replayed decision denial, competing proposal expiry, rejection preserving the active itinerary, and accepted history surviving input edits.
- Transaction rollback after an injected item-insert failure, with previous itinerary rows, active pointer and proposal status intact.
- UTC wall-clock placeholder mapping with the session timezone changed to `Pacific/Honolulu`, including an activity ending exactly at midnight.
- Administrative trip deletion with an accepted active proposal and cascading itinerary/proposal cleanup.
- Shared per-user and per-trip reservation counters, authorization, failed-reservation noninsertion, and expiry of both rate windows.

PGlite is a single PostgreSQL session here. These tests do **not** establish simultaneous-session lock behavior, real Supabase JWT validation, PostgREST schema exposure, deployed grants, or production latency. Advisory locks and trip/proposal row locks execute locally, but their contention behavior remains a live-test requirement.

## Public RPC Contract

Only `authenticated` has execution rights on these RPCs; each also requires a non-null `auth.uid()` and checks authorization in SQL. `service_role`, `anon`, and PUBLIC have no execution grant.

```sql
public.save_trip_proposal(
  target_trip_id uuid,
  expected_revision bigint,
  proposal_payload jsonb,
  model_identifier text
) returns public.agent_proposals

public.decide_trip_proposal(
  target_trip_id uuid,
  target_proposal_id uuid,
  decision text
) returns public.agent_proposals

public.reserve_generation(target_trip_id uuid) returns void
```

`save_trip_proposal` accepts the real owner or a planner member. It locks the trip, checks the expected revision, validates payload in SQL, and inserts only `pending` proposals with `proposal_type='gemini_itinerary'`. `model_identifier` is nonblank and at most 200 trimmed characters. Expiry is exactly 24 hours after the server-created timestamp. Validation evidence is generated by SQL, never accepted from the caller. Saving does not activate an itinerary.

`decide_trip_proposal` accepts `decision='accept'` or `'reject'` from `trips.owner_user_id` only. It locks the trip before the proposal and checks the proposal belongs to that trip. Both decisions require pending status and validated Gemini provenance metadata; this prevents rejection from returning a legacy payload through the security-definer RPC. Acceptance additionally requires unexpired state, matching revision, and successful fresh SQL validation. It replaces all days/items, records the accepting member, updates `active_proposal_id`, and expires other pending proposals in one transaction. Rejection can dispose of a stale or expired supported pending proposal and leaves the active itinerary intact. Replays are conflicts. Previously accepted proposals retain their accepted history.

`reserve_generation` accepts owner/planner users. Transaction-scoped advisory locks are acquired in user-then-trip order before checking/inserting shared counters: at most five reservations per user per hour and three per trip per ten minutes. Rejected reservations do not insert. The server must commit this RPC before calling the provider; failed provider attempts still consume a reservation. Saving a proposal does not itself call the provider or consume another reservation. No automatic reservation cleanup is configured; indexes bound the time-window lookups.

| SQLSTATE | Meaning |
| --- | --- |
| `42501` | Authentication/authorization failure or denied table/function privilege |
| `P0002` | Trip or proposal not found |
| `P0003` | Generation rate limit exceeded |
| `40001` | Revision mismatch, expired acceptance, or decided-proposal replay |
| `22023` | Invalid proposal, model identifier or decision input |
| `23514` | Table check constraint violation, including trip/preference bounds |

The two proposal RPCs return the complete `agent_proposals` composite row: `id`, `trip_id`, `agent_job_id`, `proposal_type`, `status`, `title`, `summary`, `payload`, `risk_level`, `requires_confirmation`, `confirmed_by_member_id`, `confirmed_at`, `rejected_at`, `expires_at`, `created_at`, `model_identifier`, `validation_result`, `trip_revision`. There is no extra JSON wrapper in SQL.

## Payload Contract

```ts
type ProposalPayload = {
  summary: string; // nonblank, trimmed length 1..2000
  activities: Array<{
    title: string; // nonblank, trimmed length 1..200
    date: string; // real YYYY-MM-DD, within trip dates
    category: "culture" | "food" | "nature" | "shopping" | "transit";
    startTime: string; // HH:mm, 00:00..23:59
    durationMinutes: number; // integer 15..480
    estimatedCostTier: "budget" | "standard" | "premium" | "luxury";
    rationale: string; // nonblank, trimmed length 1..1000
    contingencyNote: string | null; // required; nonblank 1..1000 when string
  }>; // 1..336, every trip day represented
  assumptions: string[]; // at most 30, each nonblank trimmed length 1..1000
};
```

Unknown envelope/activity properties are rejected. SQL additionally caps the serialized JSONB payload at 262144 bytes. No coercion from string to numeric duration is allowed. Budget tiers are ordinal ceilings, not monetary spending estimates. Daily summed activity minutes may not exceed relaxed 240, balanced 360, active 480, or intense 600. Activities are sorted by date/time for validation and activation. Adjacent activities are allowed; overlapping activities and an end later than 24:00 are rejected. An end exactly at 24:00 is allowed.

Text bounds use `public.ordinary_trim(text)`, a pure immutable helper enumerating the ECMAScript `String.trim()` whitespace set: U+0009..000D, U+0020, U+00A0, U+1680, U+2000..200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. It trims edges without changing interior text. U+0085, U+180E and U+200B are not stripped, matching JavaScript. Validation checks the trimmed value; SQL does not rewrite the stored text. This helper does not classify sensitive content.

## Columns and Grants

| Table | Added Columns |
| --- | --- |
| `trips` | `revision bigint NOT NULL DEFAULT 1`, `active_proposal_id uuid NULL` |
| `agent_proposals` | `model_identifier text NULL`, `validation_result jsonb NULL`, `trip_revision bigint NULL` |
| `itinerary_items` | `local_date date NULL`, `local_start_time time without time zone NULL`, `local_end_time time without time zone NULL` |
| `trip_preferences` (new) | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `trip_id uuid NOT NULL`, `kind text NOT NULL`, `value text NOT NULL`, `confirmed_by uuid NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` |
| `generation_reservations` (new) | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `trip_id uuid NOT NULL`, `user_id uuid NOT NULL`, `created_at timestamptz NOT NULL DEFAULT clock_timestamp()` |

Legacy proposal metadata and itinerary local fields remain nullable; new RPC-created proposals/items populate them. Legacy proposals without revision/expiry/model metadata cannot be accepted by these RPCs. The active pointer uses a composite FK `(trips.id, active_proposal_id)` to `(agent_proposals.trip_id, id)` to prevent cross-trip references. It is nullable during trip insertion. Input/preference edits never clear it.

Authenticated trip insert columns are exactly `name, owner_user_id, destination_name, start_date, end_date, budget_tier, pace, notes`. Update columns are exactly `destination_name, start_date, end_date, budget_tier, pace, notes`. Table SELECT is granted with RLS, including `revision`, `active_proposal_id` and `updated_at` for explicit repository projections/order. Membership is SELECT-only. All application-role proposal/itinerary writes go through the RPCs.

Proposal SELECT requires membership plus `proposal_type='gemini_itinerary'`, `trip_revision>=1`, a model identifier of trimmed length 1..200, and `validation_result` containing JSON boolean `valid=true` and numeric `validatorVersion=1`. Legacy metadata remains null rather than being fabricated or backfilled. The predicate is shared with both decision paths through `is_validated_gemini_proposal`.

Itinerary days require at least one item with explicit local schedule columns linked to an accepted validated Gemini proposal belonging to the same trip. The member-checking `can_read_gemini_day(uuid)` security-definer helper returns only a boolean, avoiding recursive day/item RLS. Individual items also require their own same-trip accepted proposal link and local schedule columns; a readable sibling item cannot make an unsupported item visible.

Authenticated item SELECT columns are exactly `id, itinerary_day_id, agent_proposal_id, title, item_type, starts_at, ends_at, travel_minutes, estimated_cost, currency, score, recommendation_reasons, fixed_commitment, sort_order, created_at, updated_at, local_date, local_start_time, local_end_time`. `destination_id` and `safety_conflicts` are not granted. Clients must use an explicit projection; item `SELECT *` fails. These row/column guards preserve legacy database content while preventing its exposure through the narrowed itinerary reads; they do not semantically classify arbitrary text in new proposals.

Trip checks enforce nonblank destination with trimmed length <=120, nullable notes with trimmed length <=1000, dates in years 0001..9999, and inclusive duration 1..14 days. The new checks are `NOT VALID` to preserve old rows, but PostgreSQL enforces them on all new inserts/updates. An unsupported legacy row must be corrected before editing or activation; it is not silently normalized or deleted.

Ordinary preferences allow `kind` in `interest, pace, budget`, nonblank `value` with trimmed length <=500, and `confirmed_by` referencing the authenticated actor's membership in the same trip. Owner/planner writes use RLS; members can read. `trip_id` is not updateable. Material preference changes increment trip revision under the same trip row lock. These checks restrict structure and attribution; they do **not** classify sensitive free text. The application's conservative English guard is imperfect and is not enforced as a semantic classifier in SQL. Do not claim that these columns cannot contain sensitive text. The new application must not collect or copy legacy profile data through these fields.

## Schedule Storage Convention

For RPC-generated itineraries, `starts_at` is `(activity.date + activity.startTime) AT TIME ZONE 'UTC'`; `ends_at` adds the duration. These are UTC placeholders for the stated local wall-clock schedule, **not** actual destination timezone instants. The UI should display raw proposal `activity.date` / `activity.startTime`, or the explicit local columns, without browser timezone conversion. `local_end_time='24:00'` represents a midnight boundary at the end of `local_date`. Existing historical timestamp values are not backfilled or reinterpreted. Numeric `estimated_cost` retains the existing zero default because a budget tier provides no monetary amount; it must not be presented as a generated price.

## Pending Live Checks

The migration application and database-role matrix are complete. The remaining items require real authenticated HTTP sessions and separate database connections.

1. Exercise PostgREST with real owner, planner, member, viewer, unrelated-user and anonymous sessions. Verify membership SELECT, trip input column restrictions, revoked retired-table access, and direct proposal/itinerary mutation denial with both authenticated and service credentials.
3. Call the exact named-argument RPCs through the parent repository. Verify composite response serialization, SQLSTATE-to-HTTP mapping, bigint revision representation, `updated_at` ordering, expired/replayed decisions, and active history after edits.
4. In separate database sessions, race two accepts for competing proposals and race acceptance against trip/preference edits. Verify one consistent result, no partial itinerary, no stale activation, and no deadlock in the trip-then-proposal lock order.
5. In separate sessions, race reservation calls across users on one trip and across trips for one user. Verify the three-per-trip and five-per-user caps with committed transactions and independent connections.
6. Verify actual auth/JWT behavior, security-definer ownership and search paths, deployed schema-cache visibility, and wall-clock rendering in different browser/session timezones.
7. Verify fresh and legacy-data migration application and administrative deletion on the hosted PostgreSQL version, including accepted active proposal FKs.

Record commands, dates, roles and outcomes without tokens, credentials, personal profile content or secrets. Do not mark these items passed from PGlite results alone.
