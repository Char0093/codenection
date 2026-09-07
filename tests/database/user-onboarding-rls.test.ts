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

const answers = (over: Record<string, unknown> = {}) => ({
  dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
  surpriseDial: null,
  ...over,
});

async function submit(a: Record<string, unknown> = answers(), expectedRevision = 0, user = userA) {
  await actor(user);
  return db.query<{ submit_user_onboarding: number }>(
    "select public.submit_user_onboarding($1, $2::jsonb) as submit_user_onboarding",
    [expectedRevision, JSON.stringify(a)],
  );
}

const frameArgs = (over: Record<string, unknown> = {}) => ({
  name: "Melaka crew", destination: "Melaka",
  start: "2026-12-12" as string | null, end: "2026-12-14" as string | null,
  duration: null as number | null, mode: "balanced", budget: null as string | null, split: false,
  ...over,
});
async function createFrame(o = frameArgs(), user: string | null = userA) {
  await actor(user);
  return db.query<{ id: string }>(
    "select public.create_trip_group($1,$2,$3::date,$4::date,$5::int,$6,$7,$8) as id",
    [o.name, o.destination, o.start, o.end, o.duration, o.mode, o.budget, o.split],
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(AUTH_SETUP);
  expect(migrationFiles).toContain("202609060004_travel_dna_safety_baseline.sql");
  expect(migrationFiles).toContain("202609060005_travel_dna_backfill_v2.sql");
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
    await db.query(`insert into user_travel_profiles(user_id,travel_vibe) values ($1,'food')`, [userA]);
    expect((await db.query<{ travel_vibe: string }>("select travel_vibe from user_travel_profiles")).rows[0].travel_vibe).toBe("food");
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
    await db.query(`update user_travel_profiles set travel_vibe='urban' where user_id=$1`, [userA]);
    expect((await db.query<{ profile_revision: number }>(
      "select profile_revision from user_travel_profiles where user_id=$1", [userA])).rows[0].profile_revision).toBe(2);
    await expect(db.query(`update user_travel_profiles set user_id=$1 where user_id=$2`, [userB, userA]))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("has no budget_lean / pace / social_role / mobility_threshold_m column after the pivot", async () => {
    await actor(null, "postgres");
    const cols = (await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='user_travel_profiles'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual([
      "backfilled_from_trip_member_id", "created_at", "onboarding_completed_at",
      "profile_revision", "serendipity_epsilon", "travel_vibe", "updated_at", "user_id",
    ]);
  });

  it("enforces range and the reshaped completed-shape check", async () => {
    await actor(userA);
    await expect(db.query(`insert into user_travel_profiles(user_id,serendipity_epsilon) values ($1,0.9)`, [userA]))
      .rejects.toMatchObject({ code: "23514" });
    await db.query(`insert into user_travel_profiles(user_id) values ($1)`, [userA]);
    // A completed row now only needs an on-grid epsilon — no budget_lean requirement.
    await expect(db.query(
      `update user_travel_profiles set onboarding_completed_at=now(), serendipity_epsilon=0.2 where user_id=$1`, [userA],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(
      `update user_travel_profiles set onboarding_completed_at=now(), serendipity_epsilon=0.15 where user_id=$1`, [userA],
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
  it("creates a global profile with a default dial and confirmed constraints", async () => {
    const res = await submit(answers({
      dealbreakers: { dietary: ["halal", "no_peanut"], religiousAccess: ["prayer_space_needed"], mobility: [] },
    }));
    expect(res.rows[0].submit_user_onboarding).toBe(1);
    await actor(null, "postgres");
    const p = (await db.query<{ travel_vibe: string | null; serendipity_epsilon: string; onboarding_completed_at: string }>(
      "select travel_vibe, serendipity_epsilon, onboarding_completed_at from user_travel_profiles where user_id=$1", [userA])).rows[0];
    expect(p.travel_vibe).toBeNull();
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

  it("maps the optional dial onto the epsilon grid and preserves it when a redo skips it", async () => {
    expect((await submit(answers({ surpriseDial: 5 }))).rows[0].submit_user_onboarding).toBe(1);
    await actor(null, "postgres");
    let e = (await db.query<{ serendipity_epsilon: string }>(
      "select serendipity_epsilon from user_travel_profiles where user_id=$1", [userA])).rows[0].serendipity_epsilon;
    expect(e).toBe("0.300");

    await submit(answers({ surpriseDial: null }), 1);   // redo, dial skipped -> preserved
    await actor(null, "postgres");
    e = (await db.query<{ serendipity_epsilon: string }>(
      "select serendipity_epsilon from user_travel_profiles where user_id=$1", [userA])).rows[0].serendipity_epsilon;
    expect(e).toBe("0.300");

    await submit(answers({ surpriseDial: 1 }), 2);      // redo, dial set -> replaced
    await actor(null, "postgres");
    e = (await db.query<{ serendipity_epsilon: string }>(
      "select serendipity_epsilon from user_travel_profiles where user_id=$1", [userA])).rows[0].serendipity_epsilon;
    expect(e).toBe("0.000");
  });

  it("is add-only for dealbreakers on a redo", async () => {
    await submit(answers({ dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] } }));
    await submit(answers({ dealbreakers: { dietary: ["halal", "vegan"], religiousAccess: [], mobility: [] } }), 1);
    await actor(null, "postgres");
    expect((await db.query("select flag from user_travel_constraints where user_id=$1 order by flag", [userA])).rows)
      .toEqual([{ flag: "halal" }, { flag: "vegan" }]);
  });

  it("raises 42501 for anonymous, 40001 on a stale revision with atomic rollback", async () => {
    await actor(null, "anon");
    await expect(db.query("select public.submit_user_onboarding(0, $1::jsonb)", [JSON.stringify(answers())]))
      .rejects.toMatchObject({ code: "42501" });

    await submit();                                       // rev 1
    await actor(null, "postgres");
    await db.query(
      `insert into user_travel_constraints(user_id,kind,flag,created_by) values ($1,'dietary','no_pork',$1)`, [userA]);
    await expect(submit(answers({ dealbreakers: { dietary: ["halal", "no_pork"], religiousAccess: [], mobility: [] } }), 0))
      .rejects.toMatchObject({ code: "40001" });
    await actor(null, "postgres");
    expect((await db.query("select 1 from user_travel_constraints where user_id=$1 and flag='halal'", [userA])).rows)
      .toHaveLength(0);
  });

  it("raises 22023 for malformed input and writes nothing", async () => {
    for (const bad of [
      { dealbreakers: [], surpriseDial: null },
      { dealbreakers: { dietary: ["mystery"], religiousAccess: [], mobility: [] }, surpriseDial: null },
      { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: 9 },
      { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: 2.5 },
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
        await submit(answers({ dealbreakers: { dietary: [], religiousAccess: [], mobility: [], [key]: [flag] } }));
        await actor(null, "postgres");
        const row = (await db.query<{ severity: string }>(
          "select severity from user_travel_constraints where user_id=$1 and kind=$2 and flag=$3",
          [userA, dbKind[key as keyof typeof dbKind], flag])).rows[0];
        expect(row.severity).toBe(expected(flag));
      }
    }
  });
});

describe("create_trip_group (organizer frame)", () => {
  it("creates a ready trip with a destination + valid date pair + owner membership", async () => {
    const id = (await createFrame()).rows[0].id;
    await actor(null, "postgres");
    const t = (await db.query<Record<string, unknown>>(
      "select name,status,destination_name,trip_mode,split_allowed,planned_duration_days from trips where id=$1", [id])).rows[0];
    expect(t).toMatchObject({
      name: "Melaka crew", status: "ready", destination_name: "Melaka",
      trip_mode: "balanced", split_allowed: false, planned_duration_days: null,
    });
    expect((await db.query("select 1 from trip_members where trip_id=$1 and user_id=$2 and role='owner'", [id, userA])).rows)
      .toHaveLength(1);
  });

  it("creates a duration-only draft trip that still has destination + mode", async () => {
    const id = (await createFrame(frameArgs({ start: null, end: null, duration: 5 }))).rows[0].id;
    await actor(null, "postgres");
    const t = (await db.query<Record<string, unknown>>(
      "select status,destination_name,trip_mode,planned_duration_days from trips where id=$1", [id])).rows[0];
    expect(t).toMatchObject({ status: "draft", destination_name: "Melaka", trip_mode: "balanced", planned_duration_days: 5 });
  });

  it("trims the name + destination and stores an optional proposed budget tier", async () => {
    const id = (await createFrame(frameArgs({ name: "  Melaka crew  ", destination: "  Melaka  ", budget: "premium", split: true }))).rows[0].id;
    await actor(null, "postgres");
    expect((await db.query<Record<string, unknown>>(
      "select name,destination_name,proposed_budget_tier,split_allowed from trips where id=$1", [id])).rows[0])
      .toEqual({ name: "Melaka crew", destination_name: "Melaka", proposed_budget_tier: "premium", split_allowed: true });
  });

  it("rejects anon (42501) and every malformed frame (22023)", async () => {
    await actor(null, "anon");
    await expect(db.query(
      "select public.create_trip_group('n','d','2026-12-12'::date,'2026-12-14'::date,null,'balanced',null,false)"))
      .rejects.toMatchObject({ code: "42501" });
    for (const bad of [
      frameArgs({ name: "   " }),
      frameArgs({ destination: "  " }),
      frameArgs({ mode: "party" }),
      frameArgs({ start: null, end: null, duration: null }),
      frameArgs({ start: "2026-12-14", end: "2026-12-12" }),
      frameArgs({ start: "2026-12-01", end: "2026-12-30" }),
      frameArgs({ start: "2026-12-12", end: null }),
      frameArgs({ start: null, end: null, duration: 15 }),
      frameArgs({ budget: "cheap" }),
    ]) {
      await expect(createFrame(bad)).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("blocks generation on a duration-only draft without a reservation or a proposal", async () => {
    const id = (await createFrame(frameArgs({ start: null, end: null, duration: 4 }))).rows[0].id;
    await actor(null, "postgres");
    const before = (await db.query<{ n: string }>("select count(*)::int as n from generation_reservations")).rows[0].n;
    await actor(userA);
    await expect(db.query("select public.reserve_generation($1)", [id])).rejects.toMatchObject({ code: "22023" });
    await expect(db.query("select public.save_trip_proposal($1, 1, '{}'::jsonb, 'test-model')", [id]))
      .rejects.toMatchObject({ code: "22023" });
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int as n from generation_reservations")).rows[0].n).toBe(before);
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

describe("trip_member_entries + submit_member_entry + trip_alignment_summary", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    availability: { coverage: "full", arrivalDate: null, departureDate: null },
    budgetTier: "standard", pace: "balanced", safetyOverrides: [] as unknown[], ...over,
  });
  async function submitEntry(tripId: string, e: Record<string, unknown> = entry(), user: string | null = userA) {
    await actor(user);
    return db.query("select public.submit_member_entry($1::uuid, $2::jsonb)", [tripId, JSON.stringify(e)]);
  }

  it("lets a member upsert their own entry and denies a non-member (42501)", async () => {
    const id = (await createFrame()).rows[0].id;                 // userA is owner
    await expect(submitEntry(id)).resolves.toBeDefined();
    await expect(submitEntry(id, entry({ pace: "active" }))).resolves.toBeDefined();
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int n from trip_member_entries where trip_id=$1", [id])).rows[0].n).toBe(1);
    expect((await db.query<{ pace: string }>("select pace from trip_member_entries where trip_id=$1 and user_id=$2", [id, userA])).rows[0].pace).toBe("active");
    await expect(submitEntry(id, entry(), userB)).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects a malformed entry (22023) and writes nothing", async () => {
    const id = (await createFrame()).rows[0].id;
    for (const bad of [
      entry({ budgetTier: "cheap" }),
      entry({ availability: { coverage: "partial", arrivalDate: null, departureDate: null } }),
      entry({ availability: { coverage: "partial", arrivalDate: "2026-12-15", departureDate: "2026-12-13" } }), // inverted
      entry({ safetyOverrides: [{ kind: "bogus", flag: "halal" }] }),
      entry({ safetyOverrides: [{ kind: "dietary", flag: "not_a_real_flag" }] }),                               // off-vocabulary
    ]) {
      await expect(submitEntry(id, bad)).rejects.toMatchObject({ code: "22023" });
    }
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int n from trip_member_entries where trip_id=$1", [id])).rows[0].n).toBe(0);
  });

  it("denies a direct (non-RPC) entry insert for a trip the caller is not a member of", async () => {
    const id = (await createFrame()).rows[0].id;                 // userA owns it
    await actor(userDev);                                        // userDev is not a member
    await expect(db.query(
      `insert into trip_member_entries(trip_id,user_id,availability_coverage,budget_tier,pace)
       values ($1,$2,'full','standard','balanced')`, [id, userDev]))
      .rejects.toMatchObject({ code: "42501" });
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int n from trip_member_entries where trip_id=$1", [id])).rows[0].n).toBe(0);
  });

  it("denies moving an entry into a trip the caller is not a member of (42501)", async () => {
    const mine = (await createFrame()).rows[0].id;               // userA owns it
    const theirs = (await createFrame(frameArgs({ name: "Their crew" }), userB)).rows[0].id;
    await submitEntry(mine);
    await actor(userA);
    await expect(db.query("update trip_member_entries set trip_id=$1 where trip_id=$2", [theirs, mine]))
      .rejects.toMatchObject({ code: "42501" });
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int n from trip_member_entries where trip_id=$1", [theirs])).rows[0].n).toBe(0);
  });

  it("stops a removed member from updating their residual entry and drops it from the summary", async () => {
    const id = (await createFrame()).rows[0].id;                 // userA is owner
    await actor(null, "postgres");
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'Member B','member')", [id, userB]);
    await submitEntry(id, entry({ budgetTier: "budget" }), userA);
    await submitEntry(id, entry({ budgetTier: "premium" }), userB);
    await actor(userA);
    expect((await db.query<{ s: Record<string, unknown> }>("select public.trip_alignment_summary($1::uuid) as s", [id])).rows[0].s)
      .toMatchObject({ memberCount: 2 });

    await actor(null, "postgres");
    await db.query("delete from trip_members where trip_id=$1 and user_id=$2", [id, userB]);
    await actor(userB);
    // The residual row is still self-readable, but no longer writable, and the RPC ignores it.
    expect((await db.query("select 1 from trip_member_entries where trip_id=$1", [id])).rows).toHaveLength(1);
    expect((await db.query("update trip_member_entries set pace='intense' where trip_id=$1", [id])).affectedRows).toBe(0);
    await expect(submitEntry(id, entry(), userB)).rejects.toMatchObject({ code: "42501" });
    await actor(null, "postgres");
    expect((await db.query<{ pace: string }>("select pace from trip_member_entries where trip_id=$1 and user_id=$2", [id, userB])).rows[0].pace).toBe("balanced");
    await actor(userA);
    expect((await db.query<{ s: unknown }>("select public.trip_alignment_summary($1::uuid) as s", [id])).rows[0].s).toBeNull();
  });

  it("stops a member smuggling an off-vocabulary override or inverted range past the RPC", async () => {
    const id = (await createFrame()).rows[0].id;                 // userA is a member (owner)
    await actor(userA);
    await expect(db.query(
      `insert into trip_member_entries(trip_id,user_id,availability_coverage,budget_tier,pace,safety_overrides)
       values ($1,$2,'full','standard','balanced','[{"kind":"dietary","flag":"pwned <b>text</b>"}]'::jsonb)`,
      [id, userA])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(
      `insert into trip_member_entries(trip_id,user_id,availability_coverage,arrival_date,departure_date,budget_tier,pace)
       values ($1,$2,'partial','2026-12-15','2026-12-13','standard','balanced')`,
      [id, userA])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(
      `insert into trip_member_entries(trip_id,user_id,availability_coverage,budget_tier,pace,safety_overrides)
       values ($1,$2,'full','standard','balanced','[{"kind":"dietary","flag":"halal"},{"kind":"dietary","flag":"halal"}]'::jsonb)`,
      [id, userA])).rejects.toMatchObject({ code: "23514" });
    await expect(submitEntry(id, entry({
      safetyOverrides: [{ kind: "dietary", flag: "halal" }, { kind: "dietary", flag: "halal" }],
    }))).rejects.toMatchObject({ code: "22023" });
    await actor(null, "postgres");
    expect((await db.query<{ n: string }>("select count(*)::int n from trip_member_entries where trip_id=$1", [id])).rows[0].n).toBe(0);
  });

  it("trip_alignment_summary returns aggregate-only jsonb with no user ids, and null below the floor", async () => {
    const id = (await createFrame()).rows[0].id;                 // userA is owner
    await actor(null, "postgres");
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'Member B','member')", [id, userB]);
    await submitEntry(id, entry({ budgetTier: "budget", pace: "relaxed" }), userA);
    await actor(userA);
    expect((await db.query<{ s: unknown }>("select public.trip_alignment_summary($1::uuid) as s", [id])).rows[0].s).toBeNull();
    await submitEntry(id, entry({ budgetTier: "premium", safetyOverrides: [{ kind: "dietary", flag: "halal" }] }), userB);
    await actor(userA);
    const s = (await db.query<{ s: Record<string, unknown> }>("select public.trip_alignment_summary($1::uuid) as s", [id])).rows[0].s;
    expect(s).toMatchObject({ memberCount: 2, budget: { min: "budget", max: "premium" }, availability: { full: 2, partial: 0 } });
    expect(JSON.stringify(s)).not.toMatch(new RegExp(`${userA}|${userB}`));
    expect(JSON.stringify(s)).not.toMatch(/user_id|"id"/);
    await actor(userDev);
    await expect(db.query("select public.trip_alignment_summary($1::uuid)", [id])).rejects.toMatchObject({ code: "42501" });
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

describe("draft trip auto-promotion still works", () => {
  it("auto-promotes a plain draft to ready once it has a destination and a valid range", async () => {
    await actor(userA);
    await db.query(`update trips set destination_name='Melaka', start_date='2026-12-14' where id=$1`, [draftA]);
    expect(await pgStatus(draftA)).toBe("draft");
    await actor(userA);
    await db.query(`update trips set end_date='2026-12-16' where id=$1`, [draftA]);
    expect(await pgStatus(draftA)).toBe("ready");
  });
});
