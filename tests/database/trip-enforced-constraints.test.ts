import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

const userA = "00000000-0000-4000-8000-0000000007a1";
const userB = "00000000-0000-4000-8000-0000000007b2";
const userC = "00000000-0000-4000-8000-0000000007c3";

let db: PGlite;

async function actor(user: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
}

async function submitGlobal(user: string, dietary: string[]) {
  await actor(user);
  await db.query("select public.submit_user_onboarding(0, $1::jsonb)", [
    JSON.stringify({ dealbreakers: { dietary, religiousAccess: [], mobility: [] }, surpriseDial: null }),
  ]);
}

async function createTrip(user: string): Promise<string> {
  await actor(user);
  return (await db.query<{ id: string }>(
    "select public.create_trip_group($1,$2,$3::date,$4::date,null,'balanced',null,false) as id",
    ["Trip", "Kuala Lumpur", "2026-12-12", "2026-12-14"])).rows[0].id;
}

async function memberId(tripId: string, user: string): Promise<string> {
  await actor(null, "postgres");
  return (await db.query<{ id: string }>(
    "select id from trip_members where trip_id=$1 and user_id=$2", [tripId, user])).rows[0].id;
}

async function enforced(tripId: string, user: string) {
  await actor(user);
  return (await db.query<Record<string, unknown>>(
    "select * from public.trip_enforced_constraints($1::uuid)", [tripId])).rows;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(AUTH_SETUP);
  expect(migrationFiles).toContain("202609060007_trip_enforced_constraints.sql");
  for (const name of migrationFiles) await loadMigration(db, name);
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [userA, userB, userC]) await db.query("insert into auth.users(id) values ($1)", [id]);
});
afterAll(async () => { await db?.close(); });

describe("trip_enforced_constraints", () => {
  it("returns the union of the trip's confirmed constraints and every member's active global confirmed constraints", async () => {
    const trip = await createTrip(userA);
    await submitGlobal(userA, ["no_peanut"]); // severe
    await submitGlobal(userB, ["halal"]);
    await actor(null, "postgres");
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'B','member')", [trip, userB]);
    const mA = await memberId(trip, userA);
    await db.query(
      "insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at) values ($1,$2,'dietary','no_pork','standard','manual',$2,now())",
      [trip, mA]);

    const rows = await enforced(trip, userA);
    expect(rows.map((r) => `${r.flag}:${r.severity}`).sort()).toEqual([
      "halal:standard", "no_peanut:severe", "no_pork:standard",
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual(["flag", "kind", "severity"]);
  });

  it("dedupes a (kind, flag) present in both scopes and keeps the strictest severity", async () => {
    const trip = await createTrip(userA);
    await submitGlobal(userA, ["no_shellfish"]); // severe globally
    const mA = await memberId(trip, userA);
    await actor(null, "postgres");
    await db.query(
      "insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source,confirmed_by,confirmed_at) values ($1,$2,'dietary','no_shellfish','standard','manual',$2,now())",
      [trip, mA]);
    expect(await enforced(trip, userA)).toEqual([{ kind: "dietary", flag: "no_shellfish", severity: "severe" }]);
  });

  it("is trip-scoped and rejects non-members and anon", async () => {
    await submitGlobal(userC, ["vegan"]); // userC joins nothing
    const trip = await createTrip(userA);
    expect(await enforced(trip, userA)).toEqual([]);
    await expect(enforced(trip, userC)).rejects.toMatchObject({ code: "42501" });
    await actor(null, "anon");
    await expect(db.query("select * from public.trip_enforced_constraints($1::uuid)", [trip])).rejects.toMatchObject({ code: "42501" });
  });

  it("ignores retired global rows and unconfirmed trip rows", async () => {
    const trip = await createTrip(userA);
    const mA = await memberId(trip, userA);
    await actor(null, "postgres");
    await db.query(
      "insert into user_travel_constraints(user_id,kind,flag,created_by,confirmed_at,retired_at) values ($1,'dietary','halal',$1,now(),now())", [userA]);
    await db.query(
      "insert into trip_constraints(trip_id,trip_member_id,kind,flag,severity,source) values ($1,$2,'mobility','no_stairs','standard','manual')", [trip, mA]);
    expect(await enforced(trip, userA)).toEqual([]);
  });
});
