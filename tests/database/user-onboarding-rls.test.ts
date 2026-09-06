import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DIETARY_FLAGS, RELIGIOUS_ACCESS_FLAGS, MOBILITY_FLAGS,
  defaultSeverity, defaultReligiousAccessSeverity, defaultMobilitySeverity,
} from "@/lib/domain/constraints";

const migrationDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const migrationFiles = readdirSync(migrationDirectory).filter((n) => n.endsWith(".sql")).sort();

const AUTH_SETUP = `create schema auth;
  create table auth.users(id uuid primary key);
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('sub', auth.uid(),
         'email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`;

function loadMigration(db: PGlite, name: string) {
  const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8")
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "");
  return db.exec(sql);
}

const userA = "00000000-0000-4000-8000-0000000003a1";
const userB = "00000000-0000-4000-8000-0000000003b2";
const userDev = "00000000-0000-4000-8000-0000000003c3";

let db: PGlite;
let tripA: string; // ready trip owned by userA
let draftA: string; // draft trip owned by userA

async function actor(user: string | null, role = "authenticated", email = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.query("select set_config('request.jwt.claim.email', $1, false)", [email]);
  await db.exec(`set role ${role}`);
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

async function submit(answers: Record<string, unknown>, expectedRevision = 0, user = userA) {
  await actor(user);
  return db.query<{ submit_user_onboarding: number }>(
    "select public.submit_user_onboarding($1, $2::jsonb) as submit_user_onboarding",
    [expectedRevision, JSON.stringify(answers)],
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(AUTH_SETUP);
  expect(migrationFiles).toContain("202609060002_user_travel_profile_chat_groups.sql");
  for (const name of migrationFiles) await loadMigration(db, name);
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [userA, userB, userDev]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }
  tripA = (await db.query<{ id: string }>(
    `insert into trips(owner_user_id,name,destination_name,start_date,end_date)
     values ($1,'KL crew','Kuala Lumpur','2026-12-12','2026-12-14') returning id`, [userA])).rows[0].id;
  draftA = (await db.query<{ id: string }>(
    `insert into trips(owner_user_id,name) values ($1,'Someday trip') returning id`, [userA])).rows[0].id;
});
afterAll(async () => { await db?.close(); });

describe("user_travel_profiles RLS", () => {
  it("lets a user write and read only their own profile", async () => {
    await actor(userA);
    await db.query(`insert into user_travel_profiles(user_id,pace) values ($1,'relaxed')`, [userA]);
    expect((await db.query<{ pace: string }>("select pace from user_travel_profiles")).rows[0].pace).toBe("relaxed");
    await actor(userB);
    expect((await db.query("select * from user_travel_profiles where user_id=$1", [userA])).rows).toHaveLength(0);
  });

  it("denies anonymous access", async () => {
    await actor(null, "anon");
    await expect(db.query(`insert into user_travel_profiles(user_id) values ($1)`, [userA]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("keeps profile_revision, user_id server-managed", async () => {
    await actor(userA);
    await expect(db.query(`insert into user_travel_profiles(user_id,profile_revision) values ($1,9)`, [userA]))
      .rejects.toMatchObject({ code: "42501" });
    await db.query(`insert into user_travel_profiles(user_id) values ($1)`, [userA]);
    await db.query(`update user_travel_profiles set pace='active' where user_id=$1`, [userA]);
    expect((await db.query<{ profile_revision: number }>(
      "select profile_revision from user_travel_profiles where user_id=$1", [userA])).rows[0].profile_revision).toBe(2);
    await expect(db.query(`update user_travel_profiles set user_id=$1 where user_id=$2`, [userB, userA]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("enforces range and completed-shape checks", async () => {
    await actor(userA);
    await expect(db.query(`insert into user_travel_profiles(user_id,serendipity_epsilon) values ($1,0.9)`, [userA]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(db.query(`insert into user_travel_profiles(user_id,mobility_threshold_m) values ($1,50001)`, [userA]))
      .rejects.toMatchObject({ code: "23514" });
    await db.query(`insert into user_travel_profiles(user_id) values ($1)`, [userA]);
    await expect(db.query(`update user_travel_profiles set onboarding_completed_at=now() where user_id=$1`, [userA]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(db.query(
      `update user_travel_profiles set onboarding_completed_at=now(), budget_lean='standard', serendipity_epsilon=0.2 where user_id=$1`, [userA],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(
      `update user_travel_profiles set onboarding_completed_at=now(), budget_lean='standard', serendipity_epsilon=0.15 where user_id=$1`, [userA],
    )).resolves.toBeDefined();
  });
});

describe("user_travel_constraints RLS + supersession", () => {
  it("is self-only through the table and the active view", async () => {
    await actor(userA);
    await db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by,confirmed_at) values ($1,'dietary','halal',$1,now())`, [userA]);
    expect((await db.query("select flag from user_travel_constraints")).rows).toHaveLength(1);
    await actor(userB);
    expect((await db.query("select flag from user_travel_constraints where user_id=$1", [userA])).rows).toHaveLength(0);
    await expect(db.query("select flag from active_user_travel_constraints")).rejects.toBeDefined();
    await actor(userA);
    await expect(db.query("select flag from active_user_travel_constraints")).rejects.toBeDefined();
  });

  it("rejects an unlisted flag and a second active (user,kind,flag)", async () => {
    await actor(userA);
    await expect(db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by) values ($1,'dietary','bad_flag',$1)`, [userA]))
      .rejects.toMatchObject({ code: "23514" });
    await db.query(`insert into user_travel_constraints(user_id,kind,flag,created_by) values ($1,'dietary','halal',$1)`, [userA]);
    await expect(db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by) values ($1,'dietary','halal',$1)`, [userA]))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("lets a fresh active row replace a retired one", async () => {
    await actor(null, "postgres");
    await db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by,retired_at) values ($1,'dietary','halal',$1,now())`, [userA]);
    await actor(userA);
    await expect(db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by) values ($1,'dietary','halal',$1)`, [userA]))
      .resolves.toBeDefined();
  });
});

describe("submit_user_onboarding", () => {
  it("creates a global profile + confirmed constraints (full)", async () => {
    const res = await submit(full({ dealbreakers: { dietary: ["halal", "no_peanut"], religiousAccess: ["prayer_space_needed"], mobility: [] } }));
    expect(res.rows[0].submit_user_onboarding).toBe(1);
    await actor(null, "postgres");
    const p = (await db.query<{ travel_vibe: string; pace: string; social_role: string; serendipity_epsilon: string; onboarding_completed_at: string }>(
      "select * from user_travel_profiles where user_id=$1", [userA])).rows[0];
    expect(p).toMatchObject({ travel_vibe: "food", pace: "active", social_role: "gourmand" });
    expect(p.serendipity_epsilon).toBe("0.150");
    expect(p.onboarding_completed_at).not.toBeNull();
    const flags = (await db.query<{ kind: string; flag: string; severity: string }>(
      "select kind, flag, severity from user_travel_constraints where user_id=$1 order by flag", [userA])).rows;
    expect(flags).toEqual([
      { kind: "dietary", flag: "halal", severity: "standard" },
      { kind: "dietary", flag: "no_peanut", severity: "severe" },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard" },
    ]);
  });

  it("writes 0.150 for a first quick submit and preserves it on a redo", async () => {
    expect((await submit(quick({ budgetLean: "budget" }))).rows[0].submit_user_onboarding).toBe(1);
    await actor(null, "postgres");
    let p = (await db.query<{ serendipity_epsilon: string; pace: string; travel_vibe: string | null }>(
      "select * from user_travel_profiles where user_id=$1", [userA])).rows[0];
    expect(p.serendipity_epsilon).toBe("0.150");
    expect(p.pace).toBe("balanced");
    expect(p.travel_vibe).toBeNull();

    await submit(full({ surpriseDial: 5 }), 1);            // -> "0.300", rev 2
    await submit(quick({ budgetLean: "luxury" }), 2);      // quick redo -> preserved
    await actor(null, "postgres");
    p = (await db.query<{ serendipity_epsilon: string; pace: string; travel_vibe: string | null }>(
      "select * from user_travel_profiles where user_id=$1", [userA])).rows[0];
    expect(p.serendipity_epsilon).toBe("0.300");
    expect(p.travel_vibe).toBe("food");
  });

  it("raises 42501 for anonymous, 40001 on a stale revision with atomic rollback", async () => {
    await actor(null, "anon");
    await expect(db.query("select public.submit_user_onboarding(0, $1::jsonb)", [JSON.stringify(quick())]))
      .rejects.toMatchObject({ code: "42501" });

    await submit(full());                                  // rev 1
    await actor(null, "postgres");
    await db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by) values ($1,'dietary','no_pork',$1)`, [userA]);
    await expect(submit(quick({ dealbreakers: { dietary: ["halal", "no_pork"], religiousAccess: [], mobility: [] } }), 0))
      .rejects.toMatchObject({ code: "40001" });
    await actor(null, "postgres");
    expect((await db.query("select 1 from user_travel_constraints where user_id=$1 and flag='halal'", [userA])).rows)
      .toHaveLength(0);
  });

  it("raises 22023 for malformed input and writes nothing", async () => {
    for (const bad of [
      { ...quick(), mode: "bogus" },
      { ...quick(), dealbreakers: { dietary: ["mystery"], religiousAccess: [], mobility: [] } },
      { ...quick(), walkingCapM: 1.5 },
      { ...quick(), budgetLean: "cheap" },
      { ...full(), surpriseDial: 9 },
    ]) {
      await expect(submit(bad)).rejects.toMatchObject({ code: "22023" });
    }
    await actor(null, "postgres");
    expect((await db.query("select 1 from user_travel_profiles where user_id=$1", [userA])).rows).toHaveLength(0);
    expect((await db.query("select 1 from user_travel_constraints where user_id=$1", [userA])).rows).toHaveLength(0);
  });

  it("stores the plan's default severity for every supported flag", async () => {
    const asStr = (fn: (flag: never) => string) => fn as (f: string) => string;
    const cases: Array<[string, readonly string[], (f: string) => string]> = [
      ["dietary", DIETARY_FLAGS, asStr(defaultSeverity)],
      ["religiousAccess", RELIGIOUS_ACCESS_FLAGS, asStr(defaultReligiousAccessSeverity)],
      ["mobility", MOBILITY_FLAGS, asStr(defaultMobilitySeverity)],
    ];
    const dbKind = { dietary: "dietary", religiousAccess: "religious_access", mobility: "mobility" } as const;
    for (const [key, flags, expected] of cases) {
      for (const flag of flags) {
        await actor(null, "postgres");
        await db.query("delete from user_travel_constraints where user_id=$1", [userA]);
        await db.query("delete from user_travel_profiles where user_id=$1", [userA]);
        await submit(full({ dealbreakers: { dietary: [], religiousAccess: [], mobility: [], [key]: [flag] } }));
        await actor(null, "postgres");
        const row = (await db.query<{ severity: string }>(
          "select severity from user_travel_constraints where user_id=$1 and kind=$2 and flag=$3",
          [userA, dbKind[key as keyof typeof dbKind], flag])).rows[0];
        expect(row.severity).toBe(expected(flag));
      }
    }
  });
});

describe("create_trip_group + draft trips", () => {
  it("creates a name-only draft group with an owner membership", async () => {
    await actor(userA);
    const id = (await db.query<{ id: string }>("select public.create_trip_group($1) as id", ["  Melaka crew  "])).rows[0].id;
    await actor(null, "postgres");
    const t = (await db.query<{ name: string; status: string; destination_name: string | null }>(
      "select name, status, destination_name from trips where id=$1", [id])).rows[0];
    expect(t).toEqual({ name: "Melaka crew", status: "draft", destination_name: null });
    expect((await db.query("select 1 from trip_members where trip_id=$1 and user_id=$2 and role='owner'", [id, userA])).rows)
      .toHaveLength(1);
  });

  it("rejects an unauthenticated caller and a blank name", async () => {
    await actor(null, "anon");
    await expect(db.query("select public.create_trip_group($1)", ["x"])).rejects.toMatchObject({ code: "42501" });
    await actor(userA);
    await expect(db.query("select public.create_trip_group($1)", ["   "])).rejects.toMatchObject({ code: "22023" });
  });

  it("auto-promotes to ready only with a destination and a valid complete date range", async () => {
    await actor(userA);
    // A whitespace-only destination cannot even be stored: 202609030004's
    // trips_destination_bounds check rejects it before the promote trigger runs.
    await expect(db.query(`update trips set destination_name='   ' where id=$1`, [draftA]))
      .rejects.toMatchObject({ code: "23514" });
    await db.query(`update trips set destination_name='Melaka', start_date='2026-12-14' where id=$1`, [draftA]);
    expect((await pgStatus(draftA))).toBe("draft"); // no end_date yet
    await actor(userA);
    // An inverted range on a draft is still rejected by trips_calendar_bounds (end - start >= 0).
    await expect(db.query(`update trips set end_date='2026-12-12' where id=$1`, [draftA]))
      .rejects.toMatchObject({ code: "23514" });
    await db.query(`update trips set end_date='2026-12-16' where id=$1`, [draftA]);
    expect((await pgStatus(draftA))).toBe("ready");
  });

  it("blocks generation on a draft trip without a reservation or a proposal", async () => {
    await actor(null, "postgres");
    const before = (await db.query<{ n: string }>("select count(*)::int as n from generation_reservations")).rows[0].n;
    await actor(userA);
    await expect(db.query("select public.reserve_generation($1)", [draftA])).rejects.toMatchObject({ code: "22023" });
    await expect(db.query("select public.save_trip_proposal($1, 1, '{}'::jsonb, 'test-model')", [draftA]))
      .rejects.toMatchObject({ code: "22023" });
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int as n from generation_reservations")).rows[0].n).toBe(before);
    expect((await db.query("select 1 from agent_proposals where trip_id=$1", [draftA])).rows).toHaveLength(0);
  });

  it("preserves the dev_test@gmail.com rate-limit exemption on a ready trip", async () => {
    const devTrip = (await db.query<{ id: string }>(
      `insert into trips(owner_user_id,name,destination_name,start_date,end_date)
       values ($1,'Dev trip','Ipoh','2026-12-12','2026-12-14') returning id`, [userDev])).rows[0].id;
    await actor(userDev, "authenticated", "dev_test@gmail.com");
    for (let i = 0; i < 5; i += 1) {
      await expect(db.query("select public.reserve_generation($1)", [devTrip])).resolves.toBeDefined();
    }
    await actor(userA, "authenticated", "real@example.com");
    for (let i = 0; i < 3; i += 1) {
      await expect(db.query("select public.reserve_generation($1)", [tripA])).resolves.toBeDefined();
    }
    await expect(db.query("select public.reserve_generation($1)", [tripA])).rejects.toMatchObject({ code: "P0003" });
  });
});

async function pgStatus(id: string): Promise<string> {
  await actor(null, "postgres");
  return (await db.query<{ status: string }>("select status from trips where id=$1", [id])).rows[0].status;
}

describe("202609060002 initializes existing trips to ready", () => {
  it("backfills a pre-migration complete trip to status=ready via the column default", async () => {
    const staged = new PGlite({ extensions: { postgis, vector } });
    try {
      await staged.exec(AUTH_SETUP);
      const owner = "00000000-0000-4000-8000-0000000003d4";
      for (const name of migrationFiles) {
        if (name >= "202609060002_user_travel_profile_chat_groups.sql") break;
        await loadMigration(staged, name);
      }
      await staged.query("insert into auth.users(id) values ($1)", [owner]);
      const id = (await staged.query<{ id: string }>(
        `insert into trips(owner_user_id,name,destination_name,start_date,end_date)
         values ($1,'Legacy','Melaka','2026-12-12','2026-12-14') returning id`, [owner])).rows[0].id;
      await loadMigration(staged, "202609060002_user_travel_profile_chat_groups.sql");
      const row = (await staged.query<{ status: string }>("select status from trips where id=$1", [id])).rows[0];
      expect(row.status).toBe("ready");
    } finally {
      await staged.close();
    }
  }, 60_000);
});
