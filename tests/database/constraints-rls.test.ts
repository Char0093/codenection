import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Implementation_Plan.md Task 1.1: contract + RLS coverage for trip_constraints (all three kinds),
// traveler_profiles, and poi_catalog. trip_constraints itself predates this file (dietary-only,
// 202609050002_dietary_constraints.sql) and had no RLS test coverage until now.

const migrationDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const owner = "00000000-0000-4000-8000-000000000101";
const planner = "00000000-0000-4000-8000-000000000102";
const member = "00000000-0000-4000-8000-000000000103";
const otherMember = "00000000-0000-4000-8000-000000000104";
const stranger = "00000000-0000-4000-8000-000000000105";

let db: PGlite;
let trip: string;
let ownerMemberId: string;
let plannerMemberId: string;
let memberMemberId: string;
let otherMemberId: string;

async function actor(user: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
}

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
  expect(migrations).toContain("202609050006_traveler_profiles_poi_catalog.sql");
  for (const name of migrations) {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8")
      .replace(/^create extension if not exists pgcrypto;\s*$/gim, "");
    await db.exec(sql);
  }
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [owner, planner, member, otherMember, stranger]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }
  trip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'Melaka trip','Melaka','2026-12-12','2026-12-14') returning id`, [owner])).rows[0].id;
  ownerMemberId = (await db.query<{ id: string }>(
    `select id from trip_members where trip_id=$1 and user_id=$2`, [trip, owner])).rows[0].id;
  plannerMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Planner','planner') returning id`, [trip, planner])).rows[0].id;
  memberMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Member','member') returning id`, [trip, member])).rows[0].id;
  otherMemberId = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,role)
    values ($1,$2,'Other member','member') returning id`, [trip, otherMember])).rows[0].id;
  await actor(owner);
});
afterAll(async () => { await db?.close(); });

describe("trip_constraints RLS (dietary, religious_access, mobility)", () => {
  it("lets a member self-confirm their own dietary flag", async () => {
    await actor(member);
    const row = (await db.query<{ id: string; confirmed_at: string | null }>(
      `insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at)
       values ($1,$2,'dietary','no_peanut','severe','manual',$2,now()) returning id, confirmed_at`,
      [trip, memberMemberId])).rows[0];
    expect(row.confirmed_at).not.toBeNull();
  });

  it("lets an owner or planner confirm a flag on a member's behalf, attributed to that actor", async () => {
    await actor(owner);
    const row = (await db.query<{ confirmed_by: string }>(
      `insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at)
       values ($1,$2,'religious_access','modest_dress_required','standard','manual',$3,now()) returning confirmed_by`,
      [trip, memberMemberId, ownerMemberId])).rows[0];
    expect(row.confirmed_by).toBe(ownerMemberId);
  });

  it("accepts every valid religious_access and mobility flag", async () => {
    await actor(member);
    for (const flag of ["modest_dress_required", "prayer_space_needed", "no_alcohol_venues", "other"]) {
      await expect(db.query(
        `insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by) values ($1,$2,'religious_access',$3,$2)`,
        [trip, memberMemberId, flag])).resolves.toBeDefined();
    }
    await actor(otherMember);
    for (const flag of ["wheelchair_accessible_required", "limited_walking_distance", "no_stairs", "other"]) {
      await expect(db.query(
        `insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by) values ($1,$2,'mobility',$3,$2)`,
        [trip, otherMemberId, flag])).resolves.toBeDefined();
    }
  });

  it("rejects an unlisted flag for religious_access or mobility at the database level", async () => {
    await actor(null, "postgres");
    await expect(db.query(
      `insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by) values ($1,$2,'religious_access','free_text_reason',$2)`,
      [trip, memberMemberId])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(
      `insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by) values ($1,$2,'mobility','bad_knee',$2)`,
      [trip, memberMemberId])).rejects.toMatchObject({ code: "23514" });
  });

  it("lets any trip member read the group's confirmed and pending constraints", async () => {
    await actor(member);
    await db.query(`insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by,confirmed_at)
      values ($1,$2,'dietary','halal',$2,now())`, [trip, memberMemberId]);
    await actor(otherMember);
    expect((await db.query("select flag from trip_constraints")).rows).toHaveLength(1);
  });

  it("denies an unrelated user any access to the trip's constraints", async () => {
    await actor(member);
    await db.query(`insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by,confirmed_at)
      values ($1,$2,'dietary','halal',$2,now())`, [trip, memberMemberId]);
    await actor(stranger);
    expect((await db.query("select flag from trip_constraints")).rows).toHaveLength(0);
    await expect(db.query(
      `insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by) values ($1,$2,'dietary','vegan',$2)`,
      [trip, memberMemberId])).rejects.toMatchObject({ code: "42501" });
  });

  it("excludes an unconfirmed row from confirmed_trip_constraints", async () => {
    await actor(member);
    await db.query(`insert into trip_constraints(trip_id,trip_member_id,kind,flag,confirmed_by)
      values ($1,$2,'dietary','no_shellfish',$2)`, [trip, memberMemberId]);
    expect((await db.query("select * from confirmed_trip_constraints where trip_id=$1", [trip])).rows).toHaveLength(0);
    expect((await db.query("select * from trip_constraints where trip_id=$1", [trip])).rows).toHaveLength(1);
  });
});

describe("traveler_profiles RLS", () => {
  it("lets a member write and read their own profile", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id,pace,serendipity_epsilon)
      values ($1,$2,'active',0.3)`, [trip, memberMemberId]);
    const row = (await db.query<{ pace: string }>(
      "select pace from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows[0];
    expect(row.pace).toBe("active");
  });

  it("lets an owner or planner write a profile on a member's behalf", async () => {
    await actor(planner);
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id,pace)
      values ($1,$2,'relaxed')`, [trip, memberMemberId])).resolves.toBeDefined();
  });

  it("never lets a member read another member's profile, including social_role -- not even the owner", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id,social_role) values ($1,$2,'gourmand')`,
      [trip, memberMemberId]);
    await actor(otherMember);
    expect((await db.query("select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows).toHaveLength(0);
    await actor(owner);
    expect((await db.query("select * from traveler_profiles where trip_member_id=$1", [memberMemberId])).rows).toHaveLength(0);
  });

  it("denies an unrelated user any access to traveler profiles", async () => {
    await actor(member);
    await db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`, [trip, memberMemberId]);
    await actor(stranger);
    expect((await db.query("select * from traveler_profiles")).rows).toHaveLength(0);
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id) values ($1,$2)`,
      [trip, otherMemberId])).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects a serendipity_epsilon outside the 0.0-0.3 range", async () => {
    await actor(member);
    await expect(db.query(`insert into traveler_profiles(trip_id,trip_member_id,serendipity_epsilon)
      values ($1,$2,0.9)`, [trip, memberMemberId])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("poi_catalog RLS", () => {
  beforeEach(async () => {
    await actor(null, "postgres");
    await db.exec(`truncate poi_catalog;
      insert into poi_catalog(name,region,geog,indoor)
      values ('Test Museum','Melaka', ST_GeogFromText('SRID=4326;POINT(102.2500 2.1900)'), true)`);
  });

  it("lets any authenticated user read the shared catalog", async () => {
    await actor(stranger);
    expect((await db.query("select name from poi_catalog")).rows).toHaveLength(1);
  });

  it("denies an authenticated user write access -- only service_role seeds the catalog", async () => {
    await actor(owner);
    await expect(db.query(`insert into poi_catalog(name,region,geog,indoor)
      values ('Rogue POI','Melaka', ST_GeogFromText('SRID=4326;POINT(102.25 2.19)'), true)`))
      .rejects.toMatchObject({ code: "42501" });
  });
});
