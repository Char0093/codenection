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

const userA = "00000000-0000-4000-8000-0000000005a1";
const userB = "00000000-0000-4000-8000-0000000005b2";

let db: PGlite;

async function actor(user: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
}

async function chatHome(user: string) {
  await actor(user);
  return (await db.query<Record<string, unknown>>("select * from public.chat_home()")).rows;
}

async function ownerMemberId(tripId: string, user: string) {
  await actor(null, "postgres");
  return (await db.query<{ id: string }>(
    "select id from trip_members where trip_id=$1 and user_id=$2", [tripId, user])).rows[0].id;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { postgis, vector } });
  await db.exec(AUTH_SETUP);
  expect(migrationFiles).toContain("202609060006_chat_home.sql");
  for (const name of migrationFiles) await loadMigration(db, name);
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [userA, userB]) await db.query("insert into auth.users(id) values ($1)", [id]);
});
afterAll(async () => { await db?.close(); });

describe("chat_home()", () => {
  it("returns only the caller's trips, newest activity first, with counts and status", async () => {
    await actor(userA);
    const t1 = (await db.query<{ id: string }>(
      "select public.create_trip_group($1,$2,$3::date,$4::date,null,'balanced',null,false) as id",
      ["Trip One", "Melaka", "2026-12-12", "2026-12-14"])).rows[0].id;
    const t2 = (await db.query<{ id: string }>(
      "select public.create_trip_group($1,$2,null,null,5,'relaxed',null,false) as id",
      ["Trip Two", "Ipoh"])).rows[0].id;

    await actor(null, "postgres");
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'B','member')", [t1, userB]);
    const t2Owner = await ownerMemberId(t2, userA);
    await actor(null, "postgres");
    await db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','  hi  there  ')",
      [t2, t2Owner]);

    const rows = await chatHome(userA);
    expect(rows.map((r) => r.id)).toEqual([t2, t1]); // t2 has the newer message
    const r1 = rows.find((r) => r.id === t1)!;
    const r2 = rows.find((r) => r.id === t2)!;
    expect(Number(r1.member_count)).toBe(2);
    expect(r1.status).toBe("ready");
    expect(r2.status).toBe("draft");
    expect(String(r2.latest_message_body)).toContain("hi  there");
    expect(r1.latest_message_body).toBeNull();
    expect(Array.isArray(r1.member_avatars)).toBe(true);

    expect((await chatHome(userB)).map((r) => r.id)).toEqual([t1]); // userB only sees t1
  });

  it("caps member_avatars at 8 while member_count stays exact", async () => {
    await actor(userA);
    const id = (await db.query<{ id: string }>(
      "select public.create_trip_group($1,$2,null,null,3,'mixed',null,false) as id", ["Big", "KL"])).rows[0].id;
    await actor(null, "postgres");
    for (let i = 0; i < 10; i += 1) {
      const uid = `00000000-0000-4000-8000-0000000006${(i + 10).toString().padStart(2, "0")}`;
      await db.query("insert into auth.users(id) values ($1)", [uid]);
      await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,$3,'member')", [id, uid, `M${i}`]);
    }
    const [row] = await chatHome(userA);
    expect(Number(row.member_count)).toBe(11); // owner + 10
    expect((row.member_avatars as unknown[]).length).toBe(8);
  });

  it("is not callable anonymously", async () => {
    await actor(null, "anon");
    await expect(db.query("select * from public.chat_home()")).rejects.toBeDefined();
  });
});
