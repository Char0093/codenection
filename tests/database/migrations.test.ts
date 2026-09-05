import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const owner = "00000000-0000-4000-8000-000000000001";
const planner = "00000000-0000-4000-8000-000000000002";
const member = "00000000-0000-4000-8000-000000000003";
const viewer = "00000000-0000-4000-8000-000000000004";
const stranger = "00000000-0000-4000-8000-000000000005";
let db: PGlite;
let trip: string;
let otherTrip: string;
let legacyVisible: { proposals: unknown[]; days: unknown[]; items: unknown[] };
let legacyPreserved: { payload: unknown; summary: string; safety_conflicts: unknown };

function activity(overrides: Record<string, unknown> = {}) {
  return { title: "Museum", date: "2026-10-01", category: "culture", startTime: "09:00",
    durationMinutes: 60, estimatedCostTier: "standard", rationale: "Local history", contingencyNote: null,
    ...overrides };
}
function payload(activities = [activity(), activity({ date: "2026-10-02" })]) {
  return { summary: "Two days of local culture", activities, assumptions: ["Tickets available"] };
}
async function actor(user: string | null, role = "authenticated", email = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.query("select set_config('request.jwt.claim.email', $1, false)", [email]);
  await db.exec(`set role ${role}`);
}
async function save(body: unknown = payload(), revision = 1, target = trip) {
  return (await db.query<{ id: string; status: string; trip_revision: number; validation_result: unknown }>(
    "select * from public.save_trip_proposal($1, $2, $3::jsonb, $4)",
    [target, revision, JSON.stringify(body), "gemini-test"])).rows[0];
}
async function decide(id: string, decision = "accept", target = trip) {
  return (await db.query<{ id: string; status: string }>(
    "select * from public.decide_trip_proposal($1, $2, $3)", [target, id, decision])).rows[0];
}
async function snapshot() {
  return (await db.query(`select t.active_proposal_id, t.revision,
    (select jsonb_agg(to_jsonb(d) order by day_number) from itinerary_days d where d.trip_id=t.id) days,
    (select jsonb_agg(to_jsonb(safe_item) order by safe_item.id) from (
      select i.id,i.itinerary_day_id,i.agent_proposal_id,i.title,i.item_type,i.starts_at,i.ends_at,
        i.travel_minutes,i.estimated_cost,i.currency,i.score,i.recommendation_reasons,i.fixed_commitment,
        i.sort_order,i.created_at,i.updated_at,i.local_date,i.local_start_time,i.local_end_time
      from itinerary_items i join itinerary_days d on d.id=i.itinerary_day_id where d.trip_id=t.id
    ) safe_item) items
    from trips t where t.id=$1`, [trip])).rows[0];
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
      $$ select jsonb_build_object('sub', auth.uid(),
        'email', coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), 'test@example.invalid')) $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  expect(migrations).toContain("202609030004_narrow_trip_scope.sql");
  for (const name of migrations) {
    if (name === "202609030004_narrow_trip_scope.sql") {
      await db.exec(`insert into auth.users(id) values ('${owner}'), ('${viewer}');
        insert into trips(id,owner_user_id,name,destination_name,start_date,end_date)
          values ('${owner}','${owner}','Existing trip','Tokyo','2026-10-01','2026-10-30');
        insert into member_profiles(trip_member_id,mobility_notes)
          select id,'historical sentinel' from trip_members where trip_id='${owner}';
        insert into constraints(trip_id,kind,severity) values ('${owner}','historical','hard');
        insert into destinations(trip_id,name,category) values ('${owner}','Historical place','culture');
        insert into provider_events(trip_id,provider_name,provider_kind,status)
          values ('${owner}','Historical provider','places','ok');
        insert into agent_jobs(trip_id,job_type,trigger_source) values ('${owner}','historical','test');
        insert into trip_members(trip_id,user_id,display_name,role) values ('${owner}','${viewer}','Viewer','viewer');
        insert into agent_proposals(id,trip_id,proposal_type,title,summary,payload)
          values ('${owner}','${owner}','legacy_itinerary','Legacy','Profile-bearing summary',
            '{"medicalProfile":"synthetic legacy sentinel"}'),
          ('${planner}','${owner}','gemini_itinerary','Legacy mimic','Profile-bearing summary',
            '{"medicalProfile":"synthetic legacy sentinel"}');
        insert into itinerary_days(id,trip_id,day_date,day_number,summary)
          values ('${owner}','${owner}','2026-10-01',1,'Synthetic legacy profile day summary');
        insert into itinerary_items(id,itinerary_day_id,agent_proposal_id,title,item_type,starts_at,ends_at,currency,safety_conflicts)
          values ('${owner}','${owner}','${owner}','Legacy item','culture','2026-10-01 09:00Z','2026-10-01 10:00Z','USD',
            '["synthetic legacy profile conflict"]');`);
    }
    // PGlite supplies gen_random_uuid in core; pgcrypto is unavailable in this harness.
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8")
      .replace(/^create extension if not exists pgcrypto;\s*$/gim, "");
    await db.exec(sql);
  }
  for (const table of ["member_profiles", "constraints", "destinations", "provider_events", "agent_jobs"]) {
    expect((await db.query<{ count: number }>(`select count(*)::int count from ${table}`)).rows[0].count).toBe(1);
  }
  expect((await db.query<{ mobility_notes: string }>("select mobility_notes from member_profiles")).rows[0].mobility_notes).toBe("historical sentinel");
  legacyPreserved = (await db.query<typeof legacyPreserved>(`select p.payload,d.summary,i.safety_conflicts
    from agent_proposals p join itinerary_items i on i.agent_proposal_id=p.id
    join itinerary_days d on d.id=i.itinerary_day_id where p.id=$1`, [owner])).rows[0];
  await actor(viewer);
  legacyVisible = {
    proposals: (await db.query("select id,payload from agent_proposals")).rows,
    days: (await db.query("select id,summary from itinerary_days")).rows,
    items: (await db.query("select id,title from itinerary_items")).rows,
  };
}, 60_000);

beforeEach(async () => {
  await actor(null, "postgres");
  await db.exec("truncate auth.users cascade");
  for (const id of [owner, planner, member, viewer, stranger]) {
    await db.query("insert into auth.users(id) values ($1)", [id]);
  }
  trip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'Culture trip','Tokyo','2026-10-01','2026-10-02') returning id`, [owner])).rows[0].id;
  otherTrip = (await db.query<{ id: string }>(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
    values ($1,'Other trip','Osaka','2026-10-01','2026-10-02') returning id`, [stranger])).rows[0].id;
  for (const [id, role] of [[planner, "planner"], [member, "member"], [viewer, "viewer"]]) {
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,$3::text,$3::text::trip_role)", [trip, id, role]);
  }
  await actor(owner);
});
afterAll(async () => { await db?.close(); });

describe("narrowed database permissions", () => {
  it("preserves pre-migration profile-bearing proposal/day/item data but hides it from viewers", () => {
    expect(legacyPreserved).toEqual({ payload: { medicalProfile: "synthetic legacy sentinel" },
      summary: "Synthetic legacy profile day summary", safety_conflicts: ["synthetic legacy profile conflict"] });
    expect(legacyVisible).toEqual({ proposals: [], days: [], items: [] });
  });

  it("denies legacy item columns even on readable newly accepted itineraries", async () => {
    const p = await save();
    await decide(p.id);
    for (const user of [owner, planner, member, viewer]) {
      await actor(user);
      expect((await db.query("select id,title from itinerary_items")).rows).toHaveLength(2);
      for (const column of ["safety_conflicts", "destination_id"]) {
        await expect(db.query(`select ${column} from itinerary_items`)).rejects.toMatchObject({ code: "42501" });
      }
      await expect(db.query("select * from itinerary_items")).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("requires complete Gemini markers for proposal and itinerary reads and decisions", async () => {
    const p = await save();
    await decide(p.id);
    const pending = await save();
    for (const change of ["proposal_type='legacy'", "trip_revision=null", "model_identifier=null",
      "validation_result=null", `validation_result='{"valid":false,"validatorVersion":1}'`,
      `validation_result='{"valid":true}'`]) {
      await actor(null, "postgres");
      await db.exec(`update agent_proposals set ${change}`);
      await actor(viewer);
      expect((await db.query("select id,payload from agent_proposals")).rows).toHaveLength(0);
      expect((await db.query("select id,summary from itinerary_days")).rows).toHaveLength(0);
      expect((await db.query("select id,title from itinerary_items")).rows).toHaveLength(0);
      await actor(owner);
      await expect(decide(pending.id, "reject")).rejects.toMatchObject({ code: "22023" });
      await actor(null, "postgres");
      await db.exec(`update agent_proposals set proposal_type='gemini_itinerary',trip_revision=1,
        model_identifier='gemini-test',validation_result='{"valid":true,"validatorVersion":1}'`);
    }
  });

  it("hides itinerary links to a validated proposal belonging to another trip", async () => {
    const p = await save();
    await decide(p.id);
    await actor(stranger);
    const foreign = await save(payload(), 1, otherTrip);
    await decide(foreign.id, "accept", otherTrip);
    await actor(null, "postgres");
    await db.query(`update itinerary_items set agent_proposal_id=$1 where itinerary_day_id in
      (select id from itinerary_days where trip_id=$2)`, [foreign.id, trip]);
    await actor(viewer);
    expect((await db.query("select id,summary from itinerary_days")).rows).toHaveLength(0);
    expect((await db.query("select id,title from itinerary_items")).rows).toHaveLength(0);
  });

  it("does not expose legacy or pending items sharing a readable accepted day", async () => {
    const accepted = await save();
    await decide(accepted.id);
    const pending = await save();
    await actor(null, "postgres");
    const legacy = (await db.query<{ id: string }>(`insert into agent_proposals(trip_id,proposal_type,title,summary)
      values ($1,'legacy','Legacy','Profile-bearing legacy') returning id`, [trip])).rows[0].id;
    for (const proposal of [legacy, pending.id, null]) {
      await db.query(`insert into itinerary_items(itinerary_day_id,agent_proposal_id,title,item_type,
        starts_at,ends_at,local_date,local_start_time,local_end_time,currency,safety_conflicts)
        select id,$2,'Hidden item','culture','2026-10-01 12:00Z','2026-10-01 13:00Z',day_date,
          '12:00','13:00','USD','["synthetic legacy profile conflict"]'
        from itinerary_days where trip_id=$1 and day_number=1`, [trip, proposal]);
    }
    await actor(viewer);
    expect((await db.query("select id,summary from itinerary_days")).rows).toHaveLength(2);
    expect((await db.query("select title from itinerary_items")).rows).toEqual([{ title: "Museum" }, { title: "Museum" }]);
    await actor(null, "postgres");
    expect((await db.query("select id from itinerary_items")).rows).toHaveLength(5);
  });

  it("enforces trip input bounds on direct authenticated inserts and updates", async () => {
    for (const [column, value] of [
      ["destination_name", " "], ["destination_name", "x".repeat(121)],
      ["notes", "x".repeat(1001)], ["end_date", "2026-10-15"],
      ["start_date", "0001-01-01 BC"], ["end_date", "10000-01-01"],
    ]) {
      await expect(db.query(`update trips set ${column}=$2 where id=$1`, [trip, value])).rejects.toMatchObject({ code: "23514" });
    }
    for (const [destination, start, end, notes] of [
      [" ", "2026-10-01", "2026-10-02", null],
      ["Tokyo", "2026-10-01", "2026-10-15", null],
      ["Tokyo", "0001-01-01 BC", "0001-01-02 BC", null],
      ["Tokyo", "10000-01-01", "10000-01-02", null],
      ["Tokyo", "2026-10-01", "2026-10-02", "x".repeat(1001)],
    ]) {
      await expect(db.query(`insert into trips(owner_user_id,name,destination_name,start_date,end_date,notes)
        values ($1,'Invalid',$2,$3::date,$4::date,$5)`, [owner, destination, start, end, notes])).rejects.toMatchObject({ code: "23514" });
    }
    for (const date of ["0001-01-01", "9999-12-31"]) {
      await db.query(`insert into trips(owner_user_id,name,destination_name,start_date,end_date,notes)
        values ($1,'Boundary',$2,$3::date,$3::date,$4)`, [owner, "x".repeat(120), date, "x".repeat(1000)]);
    }
  });

  it("grants exactly the repository trip input columns", async () => {
    const columns = ["id", "owner_user_id", "name", "destination_name", "destination_place_id", "start_date", "end_date",
      "budget_tier", "pace", "base_currency", "basecamp_label", "basecamp_lat", "basecamp_lng", "notes", "created_at", "updated_at", "revision", "active_proposal_id"];
    const insert = ["name", "owner_user_id", "destination_name", "start_date", "end_date", "budget_tier", "pace", "notes"];
    const update = ["destination_name", "start_date", "end_date", "budget_tier", "pace", "notes"];
    for (const column of columns) {
      const privileges = (await db.query<{ insertable: boolean; updatable: boolean }>(`select
        has_column_privilege(current_user,'public.trips',$1,'INSERT') insertable,
        has_column_privilege(current_user,'public.trips',$1,'UPDATE') updatable`, [column])).rows[0];
      expect(privileges).toEqual({ insertable: insert.includes(column), updatable: update.includes(column) });
    }
  });

  it("reads membership without recursion and isolates unrelated users", async () => {
    for (const user of [owner, planner, member, viewer]) {
      await actor(user);
      expect((await db.query("select * from trip_members")).rows).toHaveLength(4);
      expect((await db.query("select * from trips")).rows).toHaveLength(1);
    }
    await actor(stranger);
    expect((await db.query("select * from trips where id=$1", [trip])).rows).toHaveLength(0);
    expect((await db.query("select * from trip_members where trip_id=$1", [trip])).rows).toHaveLength(0);
  });

  it("allows authenticated creation only with self ownership and default server fields", async () => {
    await db.query(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
      values ($1,'Mine','Kyoto','2026-11-01','2026-11-01')`, [owner]);
    await expect(db.query(`insert into trips(owner_user_id,name,destination_name,start_date,end_date)
      values ($1,'Forged','Kyoto','2026-11-01','2026-11-01')`, [stranger])).rejects.toThrow();
    await expect(db.query(`insert into trips(owner_user_id,name,destination_name,start_date,end_date,revision)
      values ($1,'Forged','Kyoto','2026-11-01','2026-11-01',10)`, [owner])).rejects.toThrow();
  });

  it("returns an owner's newly created trip under RLS", async () => {
    const created = await db.query<{ id: string; owner_user_id: string }>(`insert into trips(
      owner_user_id,name,destination_name,start_date,end_date
    ) values ($1,'Returned trip','Kyoto','2026-11-01','2026-11-01')
    returning id,owner_user_id`, [owner]);

    expect(created.rows).toHaveLength(1);
    expect(created.rows[0].owner_user_id).toBe(owner);
  });

  it("permits owner/planner input edits and bumps revision only on actual input changes", async () => {
    for (const [user, revision] of [[owner, 2], [planner, 3]] as const) {
      await actor(user);
      expect((await db.query<{ revision: number }>("update trips set notes=$2 where id=$1 returning revision", [trip, user])).rows[0].revision).toBe(revision);
      expect((await db.query<{ revision: number }>("update trips set notes=notes where id=$1 returning revision", [trip])).rows[0].revision).toBe(revision);
    }
    for (const user of [member, viewer, stranger]) {
      await actor(user);
      expect((await db.query("update trips set notes='denied' where id=$1 returning id", [trip])).rows).toHaveLength(0);
    }
  });

  it("denies ownership, revision, active pointer and membership forgery", async () => {
    for (const user of [owner, planner]) {
      await actor(user);
      for (const expression of [`owner_user_id='${planner}'`, "revision=50", "active_proposal_id=null", `id='${stranger}'`]) {
        await expect(db.query(`update trips set ${expression} where id=$1`, [trip])).rejects.toThrow();
      }
      await expect(db.exec("update trip_members set role='owner'")).rejects.toThrow();
      await expect(db.exec("delete from trip_members")).rejects.toThrow();
      await expect(db.query("insert into trip_members(trip_id,user_id,display_name) values ($1,$2,'Forged')", [trip, stranger])).rejects.toThrow();
    }
  });

  it("revokes every retired table privilege, including service-role bypass access, preserving tables", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await actor(owner, role);
      for (const table of ["member_profiles", "constraints", "destinations", "provider_events", "agent_jobs"]) {
        await expect(db.exec(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          expect((await db.query<{ allowed: boolean }>("select has_table_privilege(current_user,$1,$2) allowed", [`public.${table}`, privilege])).rows[0].allowed).toBe(false);
        }
      }
    }
  });

  it("denies direct proposal and itinerary writes for all application roles", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await actor(owner, role);
      for (const table of ["agent_proposals", "itinerary_days", "itinerary_items", "generation_reservations"]) {
        for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          expect((await db.query<{ allowed: boolean }>("select has_table_privilege(current_user,$1,$2) allowed", [`public.${table}`, privilege])).rows[0].allowed).toBe(false);
        }
        await expect(db.exec(`delete from ${table}`)).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("allows confirmed ordinary preferences by owner/planner and invalidates generated snapshots", async () => {
    const p = await save();
    await actor(planner);
    const confirmer = (await db.query<{ id: string }>("select id from trip_members where user_id=$1", [planner])).rows[0].id;
    const pref = (await db.query<{ id: string }>("insert into trip_preferences(trip_id,kind,value,confirmed_by) values ($1,'interest','Museums',$2) returning id", [trip, confirmer])).rows[0];
    expect((await db.query<{ revision: number }>("select revision from trips where id=$1", [trip])).rows[0].revision).toBe(2);
    await expect(db.query("insert into trip_preferences(trip_id,kind,value,confirmed_by) values ($1,'medical','Sensitive',$2)", [trip, confirmer])).rejects.toThrow();
    await expect(db.query("insert into trip_preferences(trip_id,kind,value,confirmed_by) values ($1,'interest',$2,$3)", [trip, "x".repeat(501), confirmer])).rejects.toThrow();
    await expect(db.query("insert into trip_preferences(trip_id,kind,value,confirmed_by) values ($1,'interest','Forgery',$2)", [otherTrip, confirmer])).rejects.toThrow();
    await actor(member);
    expect((await db.query("select * from trip_preferences")).rows).toHaveLength(1);
    expect((await db.query("update trip_preferences set value='Denied' returning id")).rows).toHaveLength(0);
    await actor(planner);
    await db.query("delete from trip_preferences where id=$1", [pref.id]);
    await actor(owner);
    await expect(decide(p.id)).rejects.toThrow(/revision/);
  });
});

describe("proposal validation and atomic decisions", () => {
  it("matches JavaScript trim for every whitespace code point without removing other characters", async () => {
    const codepoints = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
      ...Array.from({ length: 11 }, (_, index) => 0x2000 + index), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
      0x85, 0x180e, 0x200b];
    for (const codepoint of codepoints) {
      const edge = String.fromCodePoint(codepoint);
      for (const text of [edge, `${edge}ordinary${edge}`, `one${edge}two`]) {
        const result = (await db.query<{ trimmed: string }>("select public.ordinary_trim($1) trimmed", [text])).rows[0];
        expect(result.trimmed).toBe(text.trim());
      }
    }
  });

  it("applies upper text bounds after JavaScript-compatible edge trimming", async () => {
    const pad = (text: string) => `\t\ufeff${text}\u3000\n`;
    await db.query("update trips set destination_name=$2,notes=$3 where id=$1", [trip, pad("x".repeat(120)), pad("x".repeat(1000))]);
    const confirmer = (await db.query<{ id: string }>("select id from trip_members where user_id=$1", [owner])).rows[0].id;
    await db.query("insert into trip_preferences(trip_id,kind,value,confirmed_by) values ($1,'interest',$2,$3)",
      [trip, pad("x".repeat(500)), confirmer]);
    const body = { ...payload(), summary: pad("x".repeat(2000)), assumptions: [pad("x".repeat(1000))],
      activities: [activity({ title: pad("x".repeat(200)), rationale: pad("x".repeat(1000)), contingencyNote: pad("x".repeat(1000)) }),
        activity({ date: "2026-10-02" })] };
    const p = (await db.query<{ id: string }>("select * from save_trip_proposal($1,3,$2::jsonb,$3)",
      [trip, JSON.stringify(body), pad("x".repeat(200))])).rows[0];
    await decide(p.id);
    expect((await db.query("select id from itinerary_items")).rows).toHaveLength(2);
  });

  const whitespace = ["\t\n\r\v\f", "\u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"];
  for (const [index, blank] of whitespace.entries()) {
    const badText = [
      ["summary", { ...payload(), summary: blank }],
      ["assumptions", { ...payload(), assumptions: [blank] }],
      ...["title", "rationale", "contingencyNote"].map((field) => [field,
        payload([activity({ [field]: blank }), activity({ date: "2026-10-02" })])]),
    ];
    it.each(badText)(`rejects whitespace-only %s on direct save (set ${index})`, async (_field, bad) => {
      await expect(save(bad)).rejects.toMatchObject({ code: "22023" });
    });
    it.each(badText)(`revalidates whitespace-only %s at acceptance (set ${index})`, async (_field, bad) => {
      const active = await save();
      await decide(active.id);
      const pending = await save();
      const before = await snapshot();
      await actor(null, "postgres");
      await db.query("update agent_proposals set payload=$2::jsonb where id=$1", [pending.id, JSON.stringify(bad)]);
      await actor(owner);
      await expect(decide(pending.id)).rejects.toMatchObject({ code: "22023" });
      expect(await snapshot()).toEqual(before);
    });
    it(`rejects whitespace-only destination, preference and model (set ${index})`, async () => {
      await expect(db.query("update trips set destination_name=$2 where id=$1", [trip, blank])).rejects.toMatchObject({ code: "23514" });
      const confirmer = (await db.query<{ id: string }>("select id from trip_members where user_id=$1", [owner])).rows[0].id;
      await expect(db.query("insert into trip_preferences(trip_id,kind,value,confirmed_by) values ($1,'interest',$2,$3)",
        [trip, blank, confirmer])).rejects.toMatchObject({ code: "23514" });
      await expect(db.query("select save_trip_proposal($1,1,$2::jsonb,$3)", [trip, JSON.stringify(payload()), blank])).rejects.toMatchObject({ code: "22023" });
      const pending = await save();
      await actor(null, "postgres");
      await db.query("update agent_proposals set model_identifier=$2 where id=$1", [pending.id, blank]);
      await actor(owner);
      await expect(decide(pending.id)).rejects.toMatchObject({ code: "22023" });
    });
  }

  it("uses the repository proposal type and SQLSTATE contract", async () => {
    const missing = "00000000-0000-4000-8000-999999999999";
    await expect(save(payload(), 1, missing)).rejects.toMatchObject({ code: "P0002" });
    await expect(save(payload(), 9)).rejects.toMatchObject({ code: "40001" });
    await expect(save({})).rejects.toMatchObject({ code: "22023" });
    await expect(db.query("select save_trip_proposal($1,1,$2::jsonb,' ')", [trip, JSON.stringify(payload())])).rejects.toMatchObject({ code: "22023" });
    const p = await save();
    expect((await db.query<{ proposal_type: string }>("select proposal_type from agent_proposals where id=$1", [p.id])).rows[0].proposal_type).toBe("gemini_itinerary");
    await expect(decide(missing)).rejects.toMatchObject({ code: "P0002" });
    await expect(decide(p.id, "invalid")).rejects.toMatchObject({ code: "22023" });
    await actor(planner);
    await expect(decide(p.id)).rejects.toMatchObject({ code: "42501" });
    await actor(member);
    await expect(save()).rejects.toMatchObject({ code: "42501" });
    await actor(owner);
    await decide(p.id);
    await expect(decide(p.id)).rejects.toMatchObject({ code: "40001" });
  });

  it("matches proposal text bounds in the application schema", async () => {
    for (const bad of [{ ...payload(), summary: "x".repeat(2001) },
      payload([activity({ rationale: "x".repeat(1001) }), activity({ date: "2026-10-02" })]),
      payload([activity({ contingencyNote: "x".repeat(1001) }), activity({ date: "2026-10-02" })])]) {
      await expect(save(bad)).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("allows a complete fourteen-day trip and an activity ending exactly at midnight", async () => {
    await db.query("update trips set end_date='2026-10-14' where id=$1", [trip]);
    const activities = Array.from({ length: 14 }, (_, index) => activity({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`, startTime: "23:45", durationMinutes: 15,
    }));
    const p = await save(payload(activities), 2);
    await decide(p.id);
    expect((await db.query<{ ok: boolean }>(`select bool_and(local_end_time=time '24:00'
      and ends_at at time zone 'UTC'=(local_date+1)::timestamp) ok from itinerary_items`)).rows[0].ok).toBe(true);
    expect((await db.query("select * from itinerary_days")).rows).toHaveLength(14);
  });

  it("saves only pending server-attributed proposals with 24-hour expiry", async () => {
    await actor(planner);
    const p = await save();
    expect(p.status).toBe("pending");
    expect(p.trip_revision).toBe(1);
    expect(p.validation_result).toMatchObject({ valid: true });
    expect((await db.query<{ ok: boolean }>("select expires_at-created_at=interval '24 hours' and model_identifier='gemini-test' ok from agent_proposals where id=$1", [p.id])).rows[0].ok).toBe(true);
    expect((await db.query("select * from itinerary_days")).rows).toHaveLength(0);
    for (const user of [member, viewer, stranger]) {
      await actor(user);
      await expect(save()).rejects.toThrow();
    }
    await actor(null);
    await expect(save()).rejects.toThrow();
    await actor(owner);
    await expect(save(payload(), 0)).rejects.toThrow(/revision/);
  });

  const invalidActivities: [string, Record<string, unknown>][] = [
    ["missing date", { date: undefined }], ["outside date", { date: "2026-10-03" }],
    ["impossible date", { date: "2026-02-30" }], ["loose date", { date: "2026-10-1" }],
    ["category", { category: "unsafe" }], ["time", { startTime: "25:00" }],
    ["loose time", { startTime: "9:00" }], ["seconds", { startTime: "09:00:00" }],
    ["short duration", { durationMinutes: 14 }], ["long duration", { durationMinutes: 481 }],
    ["fractional duration", { durationMinutes: 15.5 }], ["string duration", { durationMinutes: "60" }],
    ["null duration", { durationMinutes: null }], ["budget cap", { estimatedCostTier: "premium" }],
    ["unknown tier", { estimatedCostTier: "free" }], ["cross midnight", { startTime: "23:45", durationMinutes: 30 }],
    ["blank rationale", { rationale: " " }], ["missing contingency", { contingencyNote: undefined }],
    ["blank title", { title: " " }], ["forged property", { status: "accepted" }],
  ];
  it.each(invalidActivities)("rejects %s in SQL", async (_label, overrides) => {
    await expect(save(payload([activity(overrides), activity({ date: "2026-10-02" })]))).rejects.toThrow();
    expect((await db.query("select * from agent_proposals")).rows).toHaveLength(0);
  });

  it("rejects missing days, overlap, excessive daily duration and malformed envelopes", async () => {
    for (const bad of [payload([activity()]), payload([]), { ...payload(), status: "accepted" },
      { ...payload(), summary: null }, { ...payload(), assumptions: [42] },
      payload([activity(), activity({ startTime: "09:30" }), activity({ date: "2026-10-02" })]),
      payload([activity({ durationMinutes: 361 }), activity({ date: "2026-10-02" })])]) {
      await expect(save(bad)).rejects.toThrow();
    }
    await expect(db.query("update trips set end_date='2026-10-15' where id=$1", [trip])).rejects.toMatchObject({ code: "23514" });
  });

  it.each([["relaxed", 240], ["balanced", 360], ["active", 480], ["intense", 600]] as const)(
    "enforces %s daily cap and allows adjacent activity boundaries", async (pace, cap) => {
      const revision = (await db.query<{ revision: number }>("update trips set pace=$2::pace_level where id=$1 returning revision", [trip, pace])).rows[0].revision;
      const half = cap / 2;
      const end = 9 * 60 + half;
      const secondStart = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
      const activities = [activity({ durationMinutes: half }), activity({ startTime: secondStart, durationMinutes: half }), activity({ date: "2026-10-02" })];
      await save(payload(activities), revision);
      await expect(save(payload([activities[0], { ...activities[1], durationMinutes: half + 1 }, activities[2]]), revision)).rejects.toThrow();
    });

  it("accepts once, builds dated UTC placeholder rows, and expires competing pending proposals", async () => {
    const p = await save();
    const competitor = await save();
    await actor(planner);
    await expect(decide(p.id)).rejects.toThrow();
    await actor(owner);
    await db.exec("set timezone='Pacific/Honolulu'");
    expect((await decide(p.id)).status).toBe("accepted");
    expect((await db.query<{ status: string }>("select status from agent_proposals where id=$1", [competitor.id])).rows[0].status).toBe("expired");
    expect((await snapshot())).toMatchObject({ active_proposal_id: p.id, revision: 1 });
    expect((await db.query("select * from itinerary_days")).rows).toHaveLength(2);
    const items = (await db.query<{ date: string; time: string; start: string }>(`select local_date::text date, local_start_time::text time,
      to_char(starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI') start from itinerary_items order by local_date`)).rows;
    expect(items).toEqual([
      { date: "2026-10-01", time: "09:00:00", start: "2026-10-01 09:00" },
      { date: "2026-10-02", time: "09:00:00", start: "2026-10-02 09:00" },
    ]);
    await expect(decide(p.id)).rejects.toThrow(/pending/);
    await db.exec("set timezone='UTC'");
    for (const user of [member, viewer]) {
      await actor(user);
      expect((await db.query("select id,title from itinerary_items")).rows).toHaveLength(2);
    }
    await actor(stranger);
    expect((await db.query("select * from agent_proposals")).rows).toHaveLength(0);
    expect((await db.query("select id,title from itinerary_items")).rows).toHaveLength(0);
  });

  it("preserves the active historical proposal on edits, stale accept and rejection", async () => {
    const first = await save();
    await decide(first.id);
    const stale = await save();
    await db.query("update trips set notes='Changed' where id=$1", [trip]);
    const before = await snapshot();
    await expect(decide(stale.id)).rejects.toThrow(/revision/);
    expect(await snapshot()).toEqual(before);
    expect((await decide(stale.id, "reject")).status).toBe("rejected");
    expect(await snapshot()).toEqual(before);
    const replacement = await save(payload([activity({ title: "Replacement" }), activity({ date: "2026-10-02" })]), 2);
    await decide(replacement.id);
    expect((await snapshot())).toMatchObject({ active_proposal_id: replacement.id });
    expect((await db.query<{ count: number }>("select count(*)::int count from itinerary_items")).rows[0].count).toBe(2);
    expect((await db.query<{ status: string }>("select status from agent_proposals where id=$1", [first.id])).rows[0].status).toBe("accepted");
  });

  it("deletes a trip with an accepted active proposal without a cascading FK cycle", async () => {
    const p = await save();
    await decide(p.id);
    await actor(null, "postgres");
    await db.query("delete from trips where id=$1", [trip]);
    expect((await db.query("select * from agent_proposals where trip_id=$1", [trip])).rows).toHaveLength(0);
    expect((await db.query("select * from itinerary_days where trip_id=$1", [trip])).rows).toHaveLength(0);
    expect((await db.query("select * from itinerary_items where agent_proposal_id=$1", [p.id])).rows).toHaveLength(0);
  });

  it("blocks wrong-trip decisions, invalid decisions and expired accepts", async () => {
    const p = await save();
    await expect(decide(p.id, "accept", otherTrip)).rejects.toThrow();
    await expect(decide(p.id, "accepted")).rejects.toThrow();
    await actor(null, "postgres");
    await db.query("update agent_proposals set expires_at=now()-interval '1 second' where id=$1", [p.id]);
    await actor(owner);
    await expect(decide(p.id)).rejects.toThrow(/expired/);
    expect((await db.query("select * from itinerary_days")).rows).toHaveLength(0);
  });

  it("revalidates payload at activation even after privileged tampering", async () => {
    const first = await save();
    await decide(first.id);
    const p = await save();
    const before = await snapshot();
    await actor(null, "postgres");
    await db.query("update agent_proposals set payload=$2::jsonb where id=$1", [p.id, JSON.stringify(payload([activity({ startTime: "25:00" })]))]);
    await actor(owner);
    await expect(decide(p.id)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back deleted itinerary and statuses if activation fails after replacement starts", async () => {
    const first = await save();
    await decide(first.id);
    const p = await save();
    const before = await snapshot();
    await actor(null, "postgres");
    await db.exec(`create function public.test_fail_item() returns trigger language plpgsql as $$
      begin raise exception 'injected item failure'; end $$;
      create trigger test_fail_item before insert on itinerary_items for each row execute function public.test_fail_item();`);
    await actor(owner);
    try {
      await expect(decide(p.id)).rejects.toThrow(/injected item failure/);
      expect(await snapshot()).toEqual(before);
      expect((await db.query<{ status: string }>("select status from agent_proposals where id=$1", [p.id])).rows[0].status).toBe("pending");
    } finally {
      await actor(null, "postgres");
      await db.exec("drop trigger test_fail_item on itinerary_items; drop function public.test_fail_item()");
    }
  });
});

describe("shared generation reservations", () => {
  const reserve = (target = trip) => db.query("select public.reserve_generation($1)", [target]);
  it("limits a trip to three reservations across users within ten minutes", async () => {
    await reserve();
    await actor(planner);
    await reserve();
    await actor(owner);
    await reserve();
    await expect(reserve()).rejects.toMatchObject({ code: "P0003" });
    await actor(null, "postgres");
    expect((await db.query<{ count: number }>("select count(*)::int count from generation_reservations")).rows[0].count).toBe(3);
    await db.exec("update generation_reservations set created_at=now()-interval '11 minutes'");
    await actor(owner);
    await reserve();
  });

  it("limits a user to five reservations across trips per hour", async () => {
    await actor(null, "postgres");
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'Planner','planner')", [otherTrip, owner]);
    await actor(owner);
    for (const target of [trip, trip, trip, otherTrip, otherTrip]) await reserve(target);
    await expect(reserve(otherTrip)).rejects.toThrow(/rate limit/);
    await actor(null, "postgres");
    await db.exec("update generation_reservations set created_at=now()-interval '61 minutes'");
    await actor(owner);
    await reserve(otherTrip);
  });

  it("exempts the seeded dev_test@gmail.com account from the rate limit, others unaffected", async () => {
    await reserve();
    await reserve();
    await reserve();
    await actor(owner, "authenticated", "dev_test@gmail.com");
    await reserve();
    await reserve();
    await actor(owner);
    await expect(reserve()).rejects.toMatchObject({ code: "P0003" });
  });

  it("rejects unauthorized users and exposes only authenticated RPC execution", async () => {
    for (const user of [member, viewer, stranger, null]) {
      await actor(user);
      await expect(reserve()).rejects.toThrow();
    }
    for (const role of ["anon", "service_role"]) {
      await actor(owner, role);
      await expect(reserve()).rejects.toThrow(/permission denied/);
      await expect(save()).rejects.toThrow(/permission denied/);
    }
    await actor(null, "postgres");
    const exposed = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where n.nspname='public' and acl.grantee=0 and acl.privilege_type='EXECUTE'
      and p.proname in ('save_trip_proposal','decide_trip_proposal','reserve_generation',
        'validate_trip_proposal','bump_trip_revision','bump_preference_revision',
        'is_trip_member','can_manage_trip','create_trip_owner_membership','set_updated_at',
        'ordinary_trim','is_validated_gemini_proposal','can_read_gemini_day')`)).rows;
    expect(exposed).toEqual([]);
  });
});

describe("trip chat", () => {
  async function memberIdFor(user: string, target = trip) {
    return (await db.query<{ id: string }>(
      "select id from trip_members where trip_id=$1 and user_id=$2", [target, user],
    )).rows[0].id;
  }

  it("lets any trip member read messages, and denies a stranger entirely", async () => {
    await actor(owner);
    const ownerMemberId = await memberIdFor(owner);
    await db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','Hello group')",
      [trip, ownerMemberId],
    );
    for (const user of [owner, planner, member, viewer]) {
      await actor(user);
      const rows = (await db.query("select body from chat_messages where trip_id=$1", [trip])).rows;
      expect(rows).toEqual([{ body: "Hello group" }]);
    }
    await actor(stranger);
    expect((await db.query("select body from chat_messages where trip_id=$1", [trip])).rows).toEqual([]);
  });

  it("never leaks another trip's chat by subscribing to its channel name alone", async () => {
    await actor(stranger);
    const strangerMemberId = await memberIdFor(stranger, otherTrip);
    await db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','Private to Osaka')",
      [otherTrip, strangerMemberId],
    );
    // A member of `trip` querying by `otherTrip`'s id -- the RLS check, not the channel name, must deny this.
    await actor(owner);
    expect((await db.query("select body from chat_messages where trip_id=$1", [otherTrip])).rows).toEqual([]);
  });

  it("lets a member post only as themselves, never as another member or as the assistant", async () => {
    await actor(member);
    const ownMemberId = await memberIdFor(member);
    const ownerMemberId = await memberIdFor(owner);
    await db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','My own words')",
      [trip, ownMemberId],
    );
    await expect(db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','Forged')",
      [trip, ownerMemberId],
    )).rejects.toThrow();
    await expect(db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'assistant','Pretending to be the assistant')",
      [trip, ownMemberId],
    )).rejects.toThrow();
  });

  it("rejects a stranger's write and an empty body", async () => {
    await actor(stranger);
    const strangerMemberId = await memberIdFor(stranger, otherTrip);
    await expect(db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','Uninvited')",
      [trip, strangerMemberId],
    )).rejects.toThrow();
    await actor(owner);
    const ownerMemberId = await memberIdFor(owner);
    await expect(db.query(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','   ')",
      [trip, ownerMemberId],
    )).rejects.toThrow();
  });

  it("is append-only: no update or delete privilege exists even for the author", async () => {
    await actor(owner);
    const ownerMemberId = await memberIdFor(owner);
    const id = (await db.query<{ id: string }>(
      "insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','Immutable') returning id",
      [trip, ownerMemberId],
    )).rows[0].id;
    await expect(db.query("update chat_messages set body='edited' where id=$1", [id])).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from chat_messages where id=$1", [id])).rejects.toThrow(/permission denied/);
  });

  it("orders messages stably by time with id as a tiebreak for same-instant inserts", async () => {
    await actor(null, "postgres");
    const ownerMemberId = await memberIdFor(owner);
    await db.query(`insert into chat_messages(id,trip_id,author_member_id,author_kind,body,created_at) values
      ('00000000-0000-4000-8000-0000000000a2',$1,$2,'member','second',$3),
      ('00000000-0000-4000-8000-0000000000a1',$1,$2,'member','first',$3)`,
      [trip, ownerMemberId, "2026-10-01T00:00:00.000Z"]);
    await actor(owner);
    const ordered = (await db.query<{ body: string }>(
      "select body from chat_messages where trip_id=$1 order by created_at, id", [trip],
    )).rows;
    expect(ordered.map((row) => row.body)).toEqual(["first", "second"]);
  });
});

describe("chat-driven assistant proposals", () => {
  async function memberIdFor(user: string, target = trip) {
    return (await db.query<{ id: string }>(
      "select id from trip_members where trip_id=$1 and user_id=$2", [target, user],
    )).rows[0].id;
  }
  const proposalPayload = payload([activity(), activity({ date: "2026-10-02" })]);

  it("lets any member -- not just owner or planner -- create a pending suggestion and posts it to chat", async () => {
    await actor(member);
    const memberMemberId = await memberIdFor(member);
    const created = (await db.query(
      "select * from public.save_chat_proposal($1,$2,$3::jsonb,$4,$5)",
      [trip, memberMemberId, JSON.stringify(proposalPayload), "assistant-test", "Here is a revised plan."],
    )).rows[0];
    expect(created.status).toBe("pending");
    expect(created.proposal_type).toBe("gemini_itinerary");

    const posted = (await db.query<{ author_kind: string; proposal_id: string; body: string }>(
      "select author_kind,proposal_id,body from chat_messages where trip_id=$1 order by created_at desc limit 1", [trip],
    )).rows[0];
    expect(posted).toEqual({ author_kind: "assistant", proposal_id: created.id, body: "Here is a revised plan." });
  });

  it("still only lets the trip owner accept it, identical to a button-generated proposal", async () => {
    await actor(member);
    const memberMemberId = await memberIdFor(member);
    const created = (await db.query(
      "select * from public.save_chat_proposal($1,$2,$3::jsonb,$4,$5)",
      [trip, memberMemberId, JSON.stringify(proposalPayload), "assistant-test", "Suggestion"],
    )).rows[0];

    await expect(db.query("select * from public.decide_trip_proposal($1,$2,'accept')", [trip, created.id]))
      .rejects.toThrow(/Only the trip owner/);

    await actor(owner);
    const decided = (await db.query("select * from public.decide_trip_proposal($1,$2,'accept')", [trip, created.id])).rows[0];
    expect(decided.status).toBe("accepted");
  });

  it("rejects an invalid proposal through the same validator a button-generated one uses", async () => {
    await actor(owner);
    const ownerMemberId = await memberIdFor(owner);
    await expect(db.query(
      "select * from public.save_chat_proposal($1,$2,$3::jsonb,$4,$5)",
      [trip, ownerMemberId, JSON.stringify({ summary: "x", activities: [], assumptions: [] }), "assistant-test", "Broken"],
    )).rejects.toThrow();
  });

  it("refuses to let a member author a proposal under someone else's membership id", async () => {
    await actor(member);
    const ownerMemberId = await memberIdFor(owner);
    await expect(db.query(
      "select * from public.save_chat_proposal($1,$2,$3::jsonb,$4,$5)",
      [trip, ownerMemberId, JSON.stringify(proposalPayload), "assistant-test", "Forged"],
    )).rejects.toThrow();
  });

  it("denies a stranger entirely", async () => {
    await actor(stranger);
    const strangerMemberId = await memberIdFor(stranger, otherTrip);
    await expect(db.query(
      "select * from public.save_chat_proposal($1,$2,$3::jsonb,$4,$5)",
      [trip, strangerMemberId, JSON.stringify(proposalPayload), "assistant-test", "Uninvited"],
    )).rejects.toThrow();
  });

  it("posts a plain assistant reply for any member, with no proposal attached", async () => {
    await actor(viewer);
    const posted = (await db.query<{ author_kind: string; proposal_id: string | null; body: string }>(
      "select author_kind,proposal_id,body from public.post_assistant_message($1,$2)",
      [trip, "Jonker Street opens around 6pm."],
    )).rows[0];
    expect(posted).toEqual({ author_kind: "assistant", proposal_id: null, body: "Jonker Street opens around 6pm." });
  });

  it("refuses a plain assistant reply from a non-member", async () => {
    await actor(stranger);
    await expect(db.query("select * from public.post_assistant_message($1,$2)", [trip, "Hello"])).rejects.toThrow();
  });
});

describe("reorder_itinerary_item", () => {
  async function activeItems() {
    return (await db.query<{ id: string; local_date: string; local_start_time: string; local_end_time: string }>(
      "select i.id,i.local_date,i.local_start_time,i.local_end_time from itinerary_items i " +
      "join itinerary_days d on d.id=i.itinerary_day_id where d.trip_id=$1 order by i.local_date,i.local_start_time", [trip],
    )).rows;
  }
  async function currentRevision() {
    return (await db.query<{ revision: number }>("select revision from trips where id=$1", [trip])).rows[0].revision;
  }
  async function seedActiveTrip() {
    const twoOnDayOne = payload([
      activity({ date: "2026-10-01", startTime: "09:00", durationMinutes: 60 }),
      activity({ date: "2026-10-01", startTime: "11:00", durationMinutes: 60 }),
      activity({ date: "2026-10-02", startTime: "09:00", durationMinutes: 60 }),
    ]);
    await actor(owner);
    const proposal = await save(twoOnDayOne);
    await decide(proposal.id);
    return activeItems();
  }

  it("reorders an activity within the same day", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(member);
    const moved = (await db.query(
      "select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)",
      [trip, items[0].id, revision, "2026-10-01", "13:00"],
    )).rows[0];
    expect(moved.local_start_time).toBe("13:00:00");
    expect(await currentRevision()).toBe(revision + 1);
  });

  it("moves an activity across days", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    const moved = (await db.query(
      "select i.*, d.day_date from public.reorder_itinerary_item($1,$2,$3,$4,$5) i " +
      "join itinerary_days d on d.id = i.itinerary_day_id",
      [trip, items[0].id, revision, "2026-10-02", "14:00"],
    )).rows[0];
    expect(moved.day_date.toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("refuses a stale revision so a client must refetch rather than clobber a concurrent drag", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    await db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[0].id, revision, "2026-10-01", "13:00"]);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[1].id, revision, "2026-10-01", "15:00"]))
      .rejects.toThrow();
  });

  it("refuses a drop that would overlap another activity that day", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[1].id, revision, "2026-10-01", "09:30"]))
      .rejects.toThrow();
  });

  it("refuses a drop that would cross midnight", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[0].id, revision, "2026-10-01", "23:30"]))
      .rejects.toThrow();
  });

  it("refuses a date outside the trip's own range", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[0].id, revision, "2026-11-01", "09:00"]))
      .rejects.toThrow(/outside the trip range/);
  });

  it("denies a non-member entirely", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(stranger);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[0].id, revision, "2026-10-01", "13:00"]))
      .rejects.toThrow();
  });

  it("resizes an activity's duration via the optional 6th parameter, keeping the same start", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(member);
    const resized = (await db.query(
      "select * from public.reorder_itinerary_item($1,$2,$3,$4,$5,$6)",
      [trip, items[0].id, revision, "2026-10-01", "09:00", 90],
    )).rows[0];
    expect(resized.local_start_time).toBe("09:00:00");
    expect(resized.local_end_time).toBe("10:30:00");
  });

  it("refuses a resize duration outside the 15-480 minute domain contract", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5,$6)", [trip, items[0].id, revision, "2026-10-01", "09:00", 10]))
      .rejects.toThrow(/between 15 and 480/);
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5,$6)", [trip, items[0].id, revision, "2026-10-01", "09:00", 500]))
      .rejects.toThrow(/between 15 and 480/);
  });

  it("still refuses an overlap when the resize is what causes it", async () => {
    const items = await seedActiveTrip();
    const revision = await currentRevision();
    await actor(owner);
    // items[0] is 09:00-10:00, items[1] is 11:00-12:00 -- growing item 0 to 135 minutes (ending
    // 11:15) overlaps it; 120 minutes would only touch its boundary, not overlap it.
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5,$6)", [trip, items[0].id, revision, "2026-10-01", "09:00", 135]))
      .rejects.toThrow();
  });
});

describe("schedule_poi_item / unschedule_itinerary_item", () => {
  async function seedTripAndPoi() {
    await actor(owner);
    const proposal = await save(payload([
      activity({ date: "2026-10-01", startTime: "09:00", durationMinutes: 60 }),
      activity({ date: "2026-10-02", startTime: "09:00", durationMinutes: 60 }),
    ]));
    await decide(proposal.id);
    await actor(null, "postgres");
    const poi = (await db.query<{ id: string }>(
      // poi_catalog is shared reference data, not trip-scoped, so beforeEach's truncate does not
      // clear it. Upsert (and reset business_status) so each test starts from the same row.
      `insert into poi_catalog(name, region, geog, latitude, longitude, indoor)
       values ('Stadthuys', 'Old Town/Melaka', 'SRID=4326;POINT(102.249154 2.194059)'::geography, 2.194059, 102.249154, true)
       on conflict (name, region) do update set business_status = null, latitude = excluded.latitude
       returning id`,
    )).rows[0];
    await actor(owner);
    return poi.id;
  }
  async function currentRevision() {
    return (await db.query<{ revision: number }>("select revision from trips where id=$1", [trip])).rows[0].revision;
  }

  it("schedules a pool place onto a trip day and links it to the catalog row", async () => {
    const poiId = await seedTripAndPoi();
    const revision = await currentRevision();
    await actor(member);
    const scheduled = (await db.query<{ poi_id: string; local_start_time: string; local_end_time: string; title: string }>(
      "select * from public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)",
      [trip, poiId, revision, "2026-10-01", "13:00", 90, "culture"],
    )).rows[0];
    expect(scheduled.poi_id).toBe(poiId);
    expect(scheduled.title).toBe("Stadthuys");
    expect(scheduled.local_end_time).toBe("14:30:00");
    expect(await currentRevision()).toBe(revision + 1);
  });

  it("is readable afterwards -- the pool-scheduled item is not hidden by the Gemini-provenance policy", async () => {
    const poiId = await seedTripAndPoi();
    await db.query("select * from public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, await currentRevision(), "2026-10-01", "13:00", 90, "culture"]);
    await actor(member);
    const visible = (await db.query<{ id: string }>(
      "select i.id from itinerary_items i join itinerary_days d on d.id=i.itinerary_day_id where i.poi_id=$1", [poiId],
    )).rows;
    expect(visible).toHaveLength(1);
  });

  it("applies the same validation set as a drag: duration domain, midnight, overlap, trip range", async () => {
    const poiId = await seedTripAndPoi();
    const revision = await currentRevision();
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-10-01", "13:00", 10, "culture"]))
      .rejects.toThrow(/between 15 and 480/);
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-10-01", "23:30", 90, "culture"]))
      .rejects.toThrow(/midnight/);
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-10-01", "09:30", 60, "culture"]))
      .rejects.toThrow(/Overlaps/);
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-11-01", "09:00", 60, "culture"]))
      .rejects.toThrow(/outside the trip range/);
  });

  it("rejects an unsupported category and a closed place", async () => {
    const poiId = await seedTripAndPoi();
    const revision = await currentRevision();
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-10-01", "13:00", 60, "heritage"]))
      .rejects.toThrow(/Unsupported activity category/);
    await actor(null, "postgres");
    await db.query("update poi_catalog set business_status='closed_permanently' where id=$1", [poiId]);
    await actor(owner);
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-10-01", "13:00", 60, "culture"]))
      .rejects.toThrow(/reported closed/);
  });

  it("denies a non-member and a stale revision", async () => {
    const poiId = await seedTripAndPoi();
    const revision = await currentRevision();
    await actor(stranger);
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision, "2026-10-01", "13:00", 60, "culture"]))
      .rejects.toThrow();
    await actor(owner);
    await expect(db.query("select public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)", [trip, poiId, revision + 99, "2026-10-01", "13:00", 60, "culture"]))
      .rejects.toThrow(/revision/);
  });

  it("returns a scheduled place to the pool, deleting the block but never the catalog row", async () => {
    const poiId = await seedTripAndPoi();
    const scheduled = (await db.query<{ id: string }>(
      "select * from public.schedule_poi_item($1,$2,$3,$4,$5,$6,$7)",
      [trip, poiId, await currentRevision(), "2026-10-01", "13:00", 90, "culture"],
    )).rows[0];

    const freed = (await db.query<{ unschedule_itinerary_item: string }>(
      "select public.unschedule_itinerary_item($1,$2,$3)", [trip, scheduled.id, await currentRevision()],
    )).rows[0].unschedule_itinerary_item;
    expect(freed).toBe(poiId);

    await actor(null, "postgres");
    expect((await db.query<{ count: number }>("select count(*)::int count from itinerary_items where id=$1", [scheduled.id])).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>("select count(*)::int count from poi_catalog where id=$1", [poiId])).rows[0].count).toBe(1);
  });

  it("refuses to unschedule a Gemini block, which has no catalog row to return to", async () => {
    await seedTripAndPoi();
    const geminiItem = (await db.query<{ id: string }>(
      "select i.id from itinerary_items i join itinerary_days d on d.id=i.itinerary_day_id where d.trip_id=$1 and i.poi_id is null limit 1", [trip],
    )).rows[0];
    await actor(owner);
    await expect(db.query("select public.unschedule_itinerary_item($1,$2,$3)", [trip, geminiItem.id, await currentRevision()]))
      .rejects.toThrow(/scheduled from the pool/);
  });
});

describe("fixed_commitment lock and unlock_itinerary_item", () => {
  async function seedLockedTrip() {
    const twoOnDayOne = payload([
      activity({ date: "2026-10-01", startTime: "09:00", durationMinutes: 60 }),
      activity({ date: "2026-10-01", startTime: "11:00", durationMinutes: 60 }),
      activity({ date: "2026-10-02", startTime: "09:00", durationMinutes: 60 }),
    ]);
    await actor(owner);
    const proposal = await save(twoOnDayOne);
    await decide(proposal.id);
    const items = (await db.query<{ id: string }>(
      "select i.id from itinerary_items i join itinerary_days d on d.id=i.itinerary_day_id where d.trip_id=$1 order by i.local_start_time", [trip],
    )).rows;
    await actor(null, "postgres");
    await db.query("update itinerary_items set fixed_commitment = true where id = $1", [items[0].id]);
    await actor(owner);
    return items;
  }
  async function currentRevision() {
    return (await db.query<{ revision: number }>("select revision from trips where id=$1", [trip])).rows[0].revision;
  }

  it("refuses to move or resize a locked item", async () => {
    const items = await seedLockedTrip();
    const revision = await currentRevision();
    await expect(db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[0].id, revision, "2026-10-01", "13:00"]))
      .rejects.toThrow(/unlocked/);
  });

  it("unlocks a locked item, after which it can be moved", async () => {
    const items = await seedLockedTrip();
    let revision = await currentRevision();
    const unlocked = (await db.query("select * from public.unlock_itinerary_item($1,$2,$3)", [trip, items[0].id, revision])).rows[0];
    expect(unlocked.fixed_commitment).toBe(false);
    revision = await currentRevision();
    const moved = (await db.query("select * from public.reorder_itinerary_item($1,$2,$3,$4,$5)", [trip, items[0].id, revision, "2026-10-01", "13:00"])).rows[0];
    expect(moved.local_start_time).toBe("13:00:00");
  });

  it("unlock requires trip membership and a current revision", async () => {
    const items = await seedLockedTrip();
    const revision = await currentRevision();
    await actor(stranger);
    await expect(db.query("select * from public.unlock_itinerary_item($1,$2,$3)", [trip, items[0].id, revision])).rejects.toThrow();
    await actor(owner);
    await expect(db.query("select * from public.unlock_itinerary_item($1,$2,$3)", [trip, items[0].id, revision + 99])).rejects.toThrow();
  });
});
