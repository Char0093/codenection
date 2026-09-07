import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const migrationFiles = readdirSync(migrationDirectory).filter((n) => n.endsWith(".sql")).sort();

let db: PGlite;

const userA = "00000000-0000-4000-8000-00000000ba01";
const userB = "00000000-0000-4000-8000-00000000ba02";
const userC = "00000000-0000-4000-8000-00000000ba03"; // has an INCOMPLETE profile only
const owner = "00000000-0000-4000-8000-00000000ba09";

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function count(table: string): Promise<number> {
  return Number((await q<{ n: string }>(`select count(*)::int as n from ${table}`))[0].n);
}
async function runBackfill() {
  await db.query("select public._run_travel_dna_backfill()");
}

/** Seed a trip owned by `owner`, add `user` as a member, return the new member id. */
async function member(tripName: string, user: string): Promise<{ tripId: string; memberId: string }> {
  const tripId = (await q<{ id: string }>(
    `insert into trips(owner_user_id,name,destination_name,start_date,end_date)
     values ($1,$2,'Kuala Lumpur','2026-12-12','2026-12-14') returning id`, [owner, tripName]))[0].id;
  const memberId = (await q<{ id: string }>(
    `insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'M','member') returning id`,
    [tripId, user]))[0].id;
  return { tripId, memberId };
}
async function profile(
  tripId: string, memberId: string,
  o: { vibe: string; epsilon: number; completedAt: string | null; updatedAt?: string },
) {
  await db.query(
    `insert into traveler_profiles(trip_id,trip_member_id,travel_vibe,budget_lean,pace,
       serendipity_epsilon,onboarding_completed_at,updated_at)
     values ($1,$2,$3::traveler_travel_vibe,'standard','balanced',$4,$5,coalesce($6::timestamptz, now()))`,
    [tripId, memberId, o.vibe, o.epsilon, o.completedAt, o.updatedAt ?? null],
  );
}
async function constraint(
  tripId: string, memberId: string,
  o: { kind: string; flag: string; source?: string; confirmed?: boolean; severity?: string },
) {
  await db.query(
    `insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at)
     values ($1,$2,$3::trip_constraint_kind,$4,$5::trip_constraint_severity,$6::trip_constraint_source,$2,
             case when $7 then now() else null end)`,
    [tripId, memberId, o.kind, o.flag, o.severity ?? "standard", o.source ?? "manual", o.confirmed ?? true],
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key);
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('sub', auth.uid(), 'email', 'test@example.invalid') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  expect(migrationFiles).toContain("202609060003_backfill_global_travel_dna.sql");
  for (const name of migrationFiles) {
    await db.exec(readFileSync(`${migrationDirectory}/${name}`, "utf8")
      .replace(/^create extension if not exists pgcrypto;\s*$/gim, ""));
  }
}, 60_000);

beforeEach(async () => {
  await db.exec("truncate auth.users cascade");
  await db.exec("truncate public.user_travel_profiles, public.user_travel_constraints");
  for (const id of [userA, userB, userC, owner]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }

  // userA: two completed profiles (different completion dates) + constraints across two trips.
  const a1 = await member("A trip 1", userA);
  const a2 = await member("A trip 2", userA);
  await profile(a1.tripId, a1.memberId, { vibe: "food", epsilon: 0.15, completedAt: "2026-09-01T00:00:00Z" });
  await profile(a2.tripId, a2.memberId, { vibe: "nature", epsilon: 0.3, completedAt: "2026-09-05T00:00:00Z" });
  await constraint(a1.tripId, a1.memberId, { kind: "dietary", flag: "halal" });
  await constraint(a2.tripId, a2.memberId, { kind: "dietary", flag: "halal" });                 // dup across trips
  await constraint(a1.tripId, a1.memberId, { kind: "dietary", flag: "no_peanut", severity: "standard" }); // -> severe
  await constraint(a1.tripId, a1.memberId, { kind: "dietary", flag: "vegan", source: "chat" });  // inferred -> skip
  await constraint(a1.tripId, a1.memberId, { kind: "dietary", flag: "other" });                  // ambiguous -> skip
  await constraint(a2.tripId, a2.memberId, { kind: "dietary", flag: "no_pork", confirmed: false }); // unconfirmed -> skip

  // userB: one completed profile, one manual confirmed mobility flag.
  const b1 = await member("B trip", userB);
  await profile(b1.tripId, b1.memberId, { vibe: "urban", epsilon: 0.075, completedAt: "2026-09-03T00:00:00Z" });
  await constraint(b1.tripId, b1.memberId, { kind: "mobility", flag: "no_stairs" });

  // userC: an INCOMPLETE profile -> no global profile.
  const c1 = await member("C trip", userC);
  await profile(c1.tripId, c1.memberId, { vibe: "heritage", epsilon: 0.2, completedAt: null });
});
afterAll(async () => { await db?.close(); });

describe("_run_travel_dna_backfill", () => {
  beforeEach(runBackfill);

  it("backfills one deterministically-chosen profile per eligible user", async () => {
    const rows = await q<{ user_id: string; travel_vibe: string; serendipity_epsilon: string; onboarding_completed_at: string }>(
      "select user_id, travel_vibe, serendipity_epsilon, onboarding_completed_at::text as onboarding_completed_at from user_travel_profiles order by travel_vibe");
    expect(rows.map((r) => r.user_id).sort()).toEqual([userA, userB].sort());
    const a = rows.find((r) => r.user_id === userA)!;
    expect(a.travel_vibe).toBe("nature");                 // the 2026-09-05 profile, not the 2026-09-01 one
    expect(Number(a.serendipity_epsilon)).toBe(0.3);      // value-preserving copy (source scale varies)
    expect(a.onboarding_completed_at).toContain("2026-09-05");
    expect(rows.find((r) => r.user_id === userC)).toBeUndefined();
  });

  it("records provenance and leaves profile_revision at 1", async () => {
    const [a] = await q<{ backfilled_from_trip_member_id: string | null; profile_revision: number }>(
      "select backfilled_from_trip_member_id, profile_revision from user_travel_profiles where user_id=$1", [userA]);
    expect(a.backfilled_from_trip_member_id).not.toBeNull();
    expect(a.profile_revision).toBe(1);
  });

  it("globalizes only confirmed manual non-'other' requirements, deduped, severity recomputed", async () => {
    const aRows = await q<{ kind: string; flag: string; severity: string; backfilled_from_trip_constraint_id: string | null }>(
      "select kind, flag, severity, backfilled_from_trip_constraint_id from user_travel_constraints where user_id=$1 order by flag", [userA]);
    expect(aRows.map((r) => `${r.flag}:${r.severity}`)).toEqual(["halal:standard", "no_peanut:severe"]);
    expect(aRows.every((r) => r.backfilled_from_trip_constraint_id !== null)).toBe(true);
    expect(await q("select 1 from user_travel_constraints where user_id=$1 and flag in ('vegan','other','no_pork')", [userA]))
      .toHaveLength(0);
    const bRows = await q<{ flag: string }>("select flag from user_travel_constraints where user_id=$1", [userB]);
    expect(bRows.map((r) => r.flag)).toEqual(["no_stairs"]);
  });

  it("is idempotent -- a second run changes nothing", async () => {
    const p1 = await count("user_travel_profiles");
    const c1 = await count("user_travel_constraints");
    await runBackfill();
    await runBackfill();
    expect(await count("user_travel_profiles")).toBe(p1);
    expect(await count("user_travel_constraints")).toBe(c1);
    expect((await q<{ profile_revision: number }>("select profile_revision from user_travel_profiles where user_id=$1", [userA]))[0].profile_revision).toBe(1);
  });

  it("never overwrites a profile the user already created natively", async () => {
    await db.exec("truncate public.user_travel_profiles");
    await db.query(
      `insert into user_travel_profiles(user_id,travel_vibe,serendipity_epsilon,onboarding_completed_at)
       values ($1,'heritage',0.0,now())`, [userA]);
    await runBackfill();
    const [a] = await q<{ travel_vibe: string; backfilled_from_trip_member_id: string | null }>(
      "select travel_vibe, backfilled_from_trip_member_id from user_travel_profiles where user_id=$1", [userA]);
    expect(a.travel_vibe).toBe("heritage");
    expect(a.backfilled_from_trip_member_id).toBeNull();
  });

  it("preserves every trip-scoped source row (compatibility window)", async () => {
    expect(await count("traveler_profiles")).toBe(4);   // A1, A2, B1, C1 all still present
    expect(await count("trip_constraints")).toBe(7);
  });

  it("reports counts that satisfy the documented invariants", async () => {
    const [r] = await q<Record<string, string>>("select * from travel_dna_backfill_report");
    const n = (k: string) => Number(r[k]);
    expect(n("eligible_source_users")).toBe(2);
    expect(n("backfilled_profiles")).toBe(2);
    expect(n("native_profiles")).toBe(0);
    expect(n("backfilled_constraints")).toBe(3);        // A: halal, no_peanut ; B: no_stairs
    expect(n("eligible_constraint_keys")).toBe(3);
    expect(n("skipped_ambiguous_or_inferred_rows")).toBeGreaterThanOrEqual(2); // chat vegan + 'other'
    expect(n("backfilled_profiles")).toBeLessThanOrEqual(n("eligible_source_users"));
    expect(n("backfilled_constraints")).toBeLessThanOrEqual(n("eligible_constraint_keys"));
  });

  it("keeps the global tables self-only after backfill", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userB]);
    await db.exec("set role authenticated");
    expect(await q("select user_id from user_travel_profiles")).toEqual([{ user_id: userB }]);
    expect((await q("select flag from user_travel_constraints")).map((x) => x.flag)).toEqual(["no_stairs"]);
    await db.exec("reset role");
  });
});

describe("determinism tie-breaks", () => {
  it("prefers the later updated_at when completion dates tie", async () => {
    await db.exec("truncate auth.users cascade");
    await db.exec("truncate public.user_travel_profiles, public.user_travel_constraints");
    for (const id of [userA, owner]) await db.query("insert into auth.users(id) values ($1)", [id]);
    const m1 = await member("tie 1", userA);
    const m2 = await member("tie 2", userA);
    const sameCompletion = "2026-09-04T00:00:00Z";
    await profile(m1.tripId, m1.memberId, { vibe: "food", epsilon: 0.15, completedAt: sameCompletion, updatedAt: "2026-09-04T01:00:00Z" });
    await profile(m2.tripId, m2.memberId, { vibe: "urban", epsilon: 0.3, completedAt: sameCompletion, updatedAt: "2026-09-04T09:00:00Z" });
    await runBackfill();
    expect((await q<{ travel_vibe: string }>("select travel_vibe from user_travel_profiles where user_id=$1", [userA]))[0].travel_vibe)
      .toBe("urban");
  });
});
