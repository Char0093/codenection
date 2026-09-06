import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DIETARY_FLAGS, RELIGIOUS_ACCESS_FLAGS, MOBILITY_FLAGS, defaultSeverity, defaultReligiousAccessSeverity, defaultMobilitySeverity } from "@/lib/domain/constraints";

const migrationDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const tripOwner = "00000000-0000-4000-8000-000000000200";
const member = "00000000-0000-4000-8000-000000000202";
const otherMember = "00000000-0000-4000-8000-000000000203";
const stranger = "00000000-0000-4000-8000-000000000204";

let db: PGlite;
let trip: string;
let otherTrip: string;
let memberMemberId: string;
let otherMemberId: string;          // a member row on `trip`
let foreignMemberId: string;        // a member row on `otherTrip`, same user as `member`

async function actor(user: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
}

/** Call the RPC as `member` with sane defaults; override via `answers`. */
async function submit(answers: Record<string, unknown>, expectedRevision = 0, actingUser = member) {
  await actor(actingUser);
  return db.query<{ submit_onboarding: string }>(
    "select public.submit_onboarding($1, $2, $3::jsonb) as submit_onboarding",
    [trip, expectedRevision, JSON.stringify(answers)],
  );
}

const quick = (over: Record<string, unknown> = {}) => ({
  mode: "quick",
  dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
  walkingCapM: null,
  budgetLean: "standard",
  ...over,
});
const full = (over: Record<string, unknown> = {}) => ({
  mode: "full",
  dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
  walkingCapM: 2000,
  budgetLean: "standard",
  vibe: "food",
  pace: "active",
  socialRole: "gourmand",
  surpriseDial: 3,
  ...over,
});

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key);
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select jsonb_build_object('sub', auth.uid(), 'email', 'test@example.invalid') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  expect(migrations).toContain("202609060001_onboarding_profile.sql");
  for (const name of migrations) {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8")
      .replace(/^create extension if not exists pgcrypto;\s*$/gim, "");
    await db.exec(sql);
  }
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [tripOwner, member, otherMember, stranger]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }
  trip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'KL trip','Kuala Lumpur','2026-12-12','2026-12-14') returning id`, [tripOwner])).rows[0].id;
  otherTrip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'Melaka trip','Melaka','2026-12-20','2026-12-22') returning id`, [tripOwner])).rows[0].id;
  memberMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Member','member') returning id`, [trip, member])).rows[0].id;
  otherMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Other','member') returning id`, [trip, otherMember])).rows[0].id;
  foreignMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Member elsewhere','member') returning id`, [otherTrip, member])).rows[0].id;
  await actor(member);
});
afterAll(async () => { await db?.close(); });

describe("202609060001 schema", () => {
  it("adds the four traveler_profiles columns with the right defaults", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    const row = (await db.query<{ profile_revision: number; onboarding_completed_at: string | null; travel_vibe: string | null; budget_lean: string | null }>(
      "select profile_revision, onboarding_completed_at, travel_vibe, budget_lean from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(row.profile_revision).toBe(1);
    expect(row.onboarding_completed_at).toBeNull();
    expect(row.travel_vibe).toBeNull();
    expect(row.budget_lean).toBeNull();
  });

  it("bumps profile_revision and updated_at on every update, ignoring any supplied value", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    await db.query(`update traveler_profiles set pace='relaxed' where trip_member_id=$1`, [memberMemberId]);
    let row = (await db.query<{ profile_revision: number }>(
      "select profile_revision from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(row.profile_revision).toBe(2);
  });

  it("rejects a client insert or update that names profile_revision or trip_id", async () => {
    await actor(member);
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id,profile_revision) values ($1,$2,99)`,
      [trip, memberMemberId])).rejects.toMatchObject({ code: "42501" });
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    await expect(db.query(`update traveler_profiles set trip_id=$1 where trip_member_id=$2`, [otherTrip, memberMemberId]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("enforces the completed-profile shape", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    // completed but no budget_lean -> rejected
    await expect(db.query(
      `update traveler_profiles set onboarding_completed_at=now() where trip_member_id=$1`, [memberMemberId],
    )).rejects.toMatchObject({ code: "23514" });
    // completed with off-grid epsilon -> rejected
    await expect(db.query(
      `update traveler_profiles set onboarding_completed_at=now(), budget_lean='standard', serendipity_epsilon=0.2 where trip_member_id=$1`,
      [memberMemberId],
    )).rejects.toMatchObject({ code: "23514" });
    // completed, budget_lean set, on-grid epsilon -> ok
    await expect(db.query(
      `update traveler_profiles set onboarding_completed_at=now(), budget_lean='standard', serendipity_epsilon=0.15 where trip_member_id=$1`,
      [memberMemberId],
    )).resolves.toBeDefined();
  });

  it("rejects a traveler_profiles row whose member belongs to another trip (composite FK)", async () => {
    await actor(null, "postgres");
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`,
      [trip, foreignMemberId])).rejects.toMatchObject({ code: "23503" });
  });
});
