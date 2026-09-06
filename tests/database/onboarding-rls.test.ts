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
  return db.query<{ submit_onboarding: number }>(
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

describe("submit_onboarding happy paths", () => {
  it("creates a profile + confirmed constraints and returns revision 1", async () => {
    const res = await submit(full({ dealbreakers: { dietary: ["halal", "no_peanut"], religiousAccess: ["prayer_space_needed"], mobility: [] } }));
    expect(res.rows[0].submit_onboarding).toBe(1);
    await actor(null, "postgres");
    const profile = (await db.query<{ travel_vibe: string; budget_lean: string; pace: string; social_role: string; serendipity_epsilon: string; mobility_threshold_m: number; onboarding_completed_at: string }>(
      "select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(profile).toMatchObject({ travel_vibe: "food", budget_lean: "standard", pace: "active", social_role: "gourmand", mobility_threshold_m: 2000 });
    expect(profile.serendipity_epsilon).toBe("0.150");
    expect(profile.onboarding_completed_at).not.toBeNull();
    const flags = (await db.query<{ kind: string; flag: string; severity: string; confirmed_at: string | null; confirmed_by: string }>(
      "select kind, flag, severity, confirmed_at, confirmed_by from trip_constraints where trip_member_id=$1 order by flag", [memberMemberId])).rows;
    expect(flags).toEqual([
      { kind: "dietary", flag: "halal", severity: "standard", confirmed_at: expect.any(Date), confirmed_by: memberMemberId },
      { kind: "dietary", flag: "no_peanut", severity: "severe", confirmed_at: expect.any(Date), confirmed_by: memberMemberId },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard", confirmed_at: expect.any(Date), confirmed_by: memberMemberId },
    ]);
  });

  it("writes 0.15 for a first quick submit and leaves the full-only fields default", async () => {
    const res = await submit(quick({ budgetLean: "budget", walkingCapM: 1000 }));
    expect(res.rows[0].submit_onboarding).toBe(1);
    await actor(null, "postgres");
    const p = (await db.query<{ serendipity_epsilon: string; pace: string; travel_vibe: string | null; social_role: string | null; budget_lean: string; mobility_threshold_m: number }>(
      "select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(p.serendipity_epsilon).toBe("0.150");
    expect(p.pace).toBe("balanced");
    expect(p.travel_vibe).toBeNull();
    expect(p.social_role).toBeNull();
    expect(p.budget_lean).toBe("budget");
    expect(p.mobility_threshold_m).toBe(1000);
  });

  it("preserves epsilon/vibe/pace/role on a quick redo of a completed profile", async () => {
    await submit(full({ surpriseDial: 5, vibe: "nature", pace: "relaxed", socialRole: "navigator" })); // rev -> 1
    const res = await submit(quick({ budgetLean: "luxury" }), 1);                                       // rev -> 2
    expect(res.rows[0].submit_onboarding).toBe(2);
    await actor(null, "postgres");
    const p = (await db.query<{ serendipity_epsilon: string; travel_vibe: string; pace: string; social_role: string; budget_lean: string }>(
      "select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(p.serendipity_epsilon).toBe("0.300");
    expect(p).toMatchObject({ travel_vibe: "nature", pace: "relaxed", social_role: "navigator", budget_lean: "luxury" });
  });

  it("stores the plan's default severity for every supported flag", async () => {
    for (const flag of DIETARY_FLAGS) {
      await actor(null, "postgres");
      await db.query("delete from trip_constraints where trip_member_id=$1", [memberMemberId]);
      await db.query("delete from traveler_profiles where trip_member_id=$1", [memberMemberId]);
      await submit(full({ dealbreakers: { dietary: [flag], religiousAccess: [], mobility: [] } }));
      await actor(null, "postgres");
      const row = (await db.query<{ severity: string }>(
        "select severity from trip_constraints where trip_member_id=$1 and flag=$2", [memberMemberId, flag])).rows[0];
      expect(row.severity).toBe(defaultSeverity(flag));
    }
    for (const flag of RELIGIOUS_ACCESS_FLAGS) {
      await actor(null, "postgres");
      await db.query("delete from trip_constraints where trip_member_id=$1", [memberMemberId]);
      await db.query("delete from traveler_profiles where trip_member_id=$1", [memberMemberId]);
      await submit(full({ dealbreakers: { dietary: [], religiousAccess: [flag], mobility: [] } }));
      await actor(null, "postgres");
      const row = (await db.query<{ severity: string }>(
        "select severity from trip_constraints where trip_member_id=$1 and flag=$2 and kind='religious_access'", [memberMemberId, flag])).rows[0];
      expect(row.severity).toBe(defaultReligiousAccessSeverity(flag));
    }
    for (const flag of MOBILITY_FLAGS) {
      await actor(null, "postgres");
      await db.query("delete from trip_constraints where trip_member_id=$1", [memberMemberId]);
      await db.query("delete from traveler_profiles where trip_member_id=$1", [memberMemberId]);
      await submit(full({ dealbreakers: { dietary: [], religiousAccess: [], mobility: [flag] } }));
      await actor(null, "postgres");
      const row = (await db.query<{ severity: string }>(
        "select severity from trip_constraints where trip_member_id=$1 and flag=$2 and kind='mobility'", [memberMemberId, flag])).rows[0];
      expect(row.severity).toBe(defaultMobilitySeverity(flag));
    }
  });
});

describe("submit_onboarding failure modes", () => {
  it("raises 42501 for a non-member", async () => {
    await db.query("insert into auth.users(id) values ($1)", [stranger]).catch(() => {});
    await expect(submit(quick(), 0, stranger)).rejects.toMatchObject({ code: "42501" });
  });

  it("raises 40001 on a stale expected revision and rolls back the constraint writes", async () => {
    await submit(full()); // rev -> 1
    await expect(submit(full({ dealbreakers: { dietary: ["vegan"], religiousAccess: [], mobility: [] } }), 0))
      .rejects.toMatchObject({ code: "40001" });
    await actor(null, "postgres");
    expect((await db.query("select 1 from trip_constraints where trip_member_id=$1 and flag='vegan'", [memberMemberId])).rows).toHaveLength(0);
  });

  it("raises 40001 when no row exists but a non-zero revision was supplied", async () => {
    await expect(submit(quick(), 7)).rejects.toMatchObject({ code: "40001" });
  });

  it("raises P0001 PENDING_CONSTRAINT_CONFLICT when an unconfirmed row blocks the add", async () => {
    await actor(null, "postgres");
    await db.query(`insert into trip_constraints(trip_id,trip_member_id,kind,flag) values ($1,$2,'dietary','vegan')`, [trip, memberMemberId]);
    await expect(submit(quick({ dealbreakers: { dietary: ["vegan"], religiousAccess: [], mobility: [] } })))
      .rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("PENDING_CONSTRAINT_CONFLICT") });
  });

  it("re-confirming an already-confirmed flag is a no-op, not a conflict", async () => {
    await submit(quick({ dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] } }));   // rev -> 1
    await expect(submit(quick({ dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] } }), 1)).resolves.toBeDefined();
  });
});

describe("submit_onboarding input validation (independent of Zod)", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["unknown mode", { ...quick(), mode: "bogus" }],
    ["missing budgetLean", (() => { const q = quick() as Record<string, unknown>; delete q.budgetLean; return q; })()],
    ["dealbreakers not an object", { ...quick(), dealbreakers: "halal" }],
    ["dietary not an array", { ...quick(), dealbreakers: { dietary: "halal", religiousAccess: [], mobility: [] } }],
    ["dietary over vocabulary length", { ...quick(), dealbreakers: { dietary: Array(20).fill("halal"), religiousAccess: [], mobility: [] } }],
    ["unknown dietary flag", { ...quick(), dealbreakers: { dietary: ["mystery"], religiousAccess: [], mobility: [] } }],
    ["walkingCapM negative", { ...quick(), walkingCapM: -5 }],
    ["walkingCapM too large", { ...quick(), walkingCapM: 999999 }],
    ["walkingCapM not a number", { ...quick(), walkingCapM: "far" }],
    ["invalid budgetLean enum", { ...quick(), budgetLean: "cheap" }],
    ["full: invalid vibe", { ...full(), vibe: "space" }],
    ["full: invalid pace", { ...full(), pace: "sprint" }],
    ["full: invalid socialRole", { ...full(), socialRole: "captain" }],
    ["full: surpriseDial out of range", { ...full(), surpriseDial: 9 }],
  ];
  for (const [name, answers] of bad) {
    it(`raises 22023 for ${name} and writes nothing`, async () => {
      await expect(submit(answers)).rejects.toMatchObject({ code: "22023" });
      await actor(null, "postgres");
      expect((await db.query("select 1 from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows).toHaveLength(0);
      expect((await db.query("select 1 from trip_constraints where trip_member_id=$1", [memberMemberId])).rows).toHaveLength(0);
    });
  }
});
