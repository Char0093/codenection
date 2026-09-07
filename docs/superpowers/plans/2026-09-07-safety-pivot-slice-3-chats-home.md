# Slice 3 — chat-group home + organizer trip creation (safety-first pivot)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD: RED → GREEN
> → commit. Umbrella: `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`. Spec:
> `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md` §2.3, §5.

**Goal:** `/chats` is the authenticated home. It lists the caller's trip groups ordered by
recent chat activity (bounded reads), has an honest empty state, and creates an
**organizer-framed** trip (destination + trip mode + dates-or-duration, optional proposed
budget / split) atomically via `create_trip_group`, then opens the trip. An authenticated
`/` redirects to `/chats`.

**Consumes (Slice 1):** `create_trip_group(text,text,date,date,int,text,text,boolean)`,
`trips.{trip_mode,planned_duration_days,proposed_budget_tier}`; `createTripFrameSchema` /
`CreateTripFrameInput` / `TRIP_MODES` / `TRIP_MODE_LABELS` (`@/lib/domain/trip`);
`chatHomeTripSchema` / `chatHomeSchema` / `toLatestMessagePreview` / `CHAT_HOME_MAX_AVATARS`
(`@/lib/domain/chat-home`).
**Consumes (existing):** `is_trip_member` / trips SELECT RLS (`owner_user_id = auth.uid() or
is_trip_member(id)`); `listTripMembers` / `colorForMemberIndex` (`@/lib/repositories/members`);
`ChatPane` (`@/features/chat/chat-pane`); `verifiedUser`, `createClient`,
`isSupabaseConfigured`, `errorResponse` / `databaseError` / `AppError`, `readJson` /
`requireSameOrigin`.

**Produces (Slice 5 relies on):**
- Migration `202609060006_chat_home.sql`: `public.chat_home()` returns one row per
  membership with a bounded latest message, member count, and ≤8 avatars, ordered by
  activity desc.
- `lib/repositories/chat-home.ts`: `getChatHome(client): Promise<ChatHome>`.
- `app/api/chats/route.ts`: `GET` → `{ trips }` (`private, no-store`); `POST` →
  `{ tripId }` `201`.
- `components/chat-home-view.tsx`: `ChatHomeView({ trips: ChatHomeTrip[] })`.
- `app/chats/page.tsx`; `app/trips/[tripId]/chat/page.tsx` (minimal, Slice 5 wraps it in
  the shared shell + adds the `/workspace` redirect).

---

## Task 1 — `chat_home()` RPC + migration

**Files:** Create `supabase/migrations/202609060006_chat_home.sql`,
`tests/database/chat-home-rpc.test.ts`.

- [ ] **Step 1: Write `tests/database/chat-home-rpc.test.ts` (RED).** PGlite, mirrors the
  `user-onboarding-rls.test.ts` harness (`AUTH_SETUP`, `loadMigration`, `actor`).

```ts
// harness identical to tests/database/user-onboarding-rls.test.ts (AUTH_SETUP, loadMigration, actor)
// userA, userB; beforeEach truncates auth.users cascade and inserts both.

async function chatHome(user: string) {
  await actor(user);
  return (await db.query("select * from public.chat_home()")).rows as any[];
}

it("returns only the caller's trips, newest activity first, with counts and capped avatars", async () => {
  await actor(userA);
  const t1 = (await db.query("select public.create_trip_group($1,$2,$3::date,$4::date,null,'balanced',null,false) as id",
    ["Trip One", "Melaka", "2026-12-12", "2026-12-14"])).rows[0].id;
  const t2 = (await db.query("select public.create_trip_group($1,$2,null,null,5,'relaxed',null,false) as id",
    ["Trip Two", "Ipoh"])).rows[0].id;
  await actor(null, "postgres");
  // add userB as a member of t1 and a chat message on t2 (newer activity)
  await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,'B','member')", [t1, userB]);
  const mB = (await db.query("select id from trip_members where trip_id=$1 and user_id=$2", [t2, userA])).rows[0]?.id
    ?? (await db.query("select id from trip_members where trip_id=$1 and user_id=$2", [t2, userA])).rows[0].id;
  await db.query("insert into chat_messages(trip_id,author_member_id,author_kind,body) values ($1,$2,'member','  hi  there  ')",
    [t2, (await db.query("select id from trip_members where trip_id=$1 and user_id=$2", [t2, userA])).rows[0].id]);

  const rows = await chatHome(userA);
  expect(rows.map((r) => r.id)).toEqual([t2, t1]);                         // t2 has the newer message
  expect(rows.find((r) => r.id === t1).member_count).toBe(2);
  expect(rows.find((r) => r.id === t2).latest_message_body).toContain("hi  there");
  expect(rows.find((r) => r.id === t1).status).toBe("ready");
  expect(rows.find((r) => r.id === t2).status).toBe("draft");
  expect(Array.isArray(rows[0].member_avatars)).toBe(true);

  const bRows = await chatHome(userB);
  expect(bRows.map((r) => r.id)).toEqual([t1]);                            // userB only sees t1
});

it("caps member_avatars at 8 while member_count stays exact", async () => {
  await actor(userA);
  const id = (await db.query("select public.create_trip_group($1,$2,null,null,3,'mixed',null,false) as id", ["Big", "KL"])).rows[0].id;
  await actor(null, "postgres");
  for (let i = 0; i < 10; i += 1) {
    const uid = `00000000-0000-4000-8000-0000000000${(i + 20).toString().padStart(2, "0")}`;
    await db.query("insert into auth.users(id) values ($1) on conflict do nothing", [uid]);
    await db.query("insert into trip_members(trip_id,user_id,display_name,role) values ($1,$2,$3,'member')", [id, uid, `M${i}`]);
  }
  const [row] = await chatHome(userA);
  expect(row.member_count).toBe(11);                                        // owner + 10
  expect(row.member_avatars.length).toBe(8);
});

it("is not callable anonymously", async () => {
  await actor(null, "anon");
  await expect(db.query("select * from public.chat_home()")).rejects.toBeDefined();
});
```

- [ ] **Step 2: Run — expect FAIL** (function missing).

- [ ] **Step 3: Write `202609060006_chat_home.sql`.**

```sql
-- Chat-group home (spec §2.3 / §5). One row per trip the caller is a member of, ordered by
-- recent chat activity, with a BOUNDED latest message (lateral limit 1), a member count, and
-- at most 8 avatars. security invoker -> the caller's RLS scopes `trips` to their own
-- memberships and `chat_messages` per-row; nothing here reads another user's data.
create function public.chat_home()
returns table (
  id uuid,
  name text,
  status public.trip_status,
  destination_name text,
  start_date date,
  end_date date,
  trip_mode public.trip_mode,
  planned_duration_days int,
  proposed_budget_tier public.budget_tier,
  member_count int,
  member_avatars jsonb,
  latest_message_body text,
  latest_message_at timestamptz,
  activity_at timestamptz
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    t.id, t.name, t.status, t.destination_name, t.start_date, t.end_date,
    t.trip_mode, t.planned_duration_days, t.proposed_budget_tier,
    (select count(*)::int from public.trip_members m where m.trip_id = t.id) as member_count,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'displayName', a.display_name) order by a.joined_at)
      from (
        select m.id, m.display_name, m.joined_at
        from public.trip_members m
        where m.trip_id = t.id
        order by m.joined_at
        limit 8
      ) a
    ), '[]'::jsonb) as member_avatars,
    lm.body as latest_message_body,
    lm.created_at as latest_message_at,
    coalesce(lm.created_at, t.updated_at) as activity_at
  from public.trips t
  left join lateral (
    select cm.body, cm.created_at
    from public.chat_messages cm
    where cm.trip_id = t.id
    order by cm.created_at desc, cm.id desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, t.updated_at) desc, t.id desc;
$$;
revoke all on function public.chat_home() from public, anon;
grant execute on function public.chat_home() to authenticated;
```

- [ ] **Step 4: Run — expect PASS.** Also run `tests/database/user-onboarding-rls.test.ts`
  + `tests/database/migrations.test.ts` (the migration-count/privilege generic checks).
- [ ] **Step 5: Commit** — `feat(db): chat_home() bounded chat-group listing`.

---

## Task 2 — `lib/repositories/chat-home.ts`

**Files:** Create `lib/repositories/chat-home.ts`, `tests/repositories/chat-home.test.ts`.

- [ ] **Step 1: Write `tests/repositories/chat-home.test.ts` (RED)** — stub the client's
  `auth.getUser` + `rpc("chat_home")`.

```ts
import { describe, expect, it, vi } from "vitest";
import { getChatHome } from "@/lib/repositories/chat-home";

const client = (rows: unknown[]) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  rpc: vi.fn(async () => ({ data: rows, error: null })),
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "12345678-1234-4123-8123-123456789012",
  name: "Melaka crew", status: "ready",
  destination_name: "Melaka", start_date: "2026-12-12", end_date: "2026-12-14",
  trip_mode: "balanced", planned_duration_days: null, proposed_budget_tier: "standard",
  member_count: 2,
  member_avatars: [{ id: "12345678-1234-4123-8123-1234567890ab", displayName: "A" }],
  latest_message_body: "  see   you  at  9  ", latest_message_at: "2026-12-01T08:00:00Z",
  activity_at: "2026-12-01T08:00:00Z", ...over,
});

describe("getChatHome", () => {
  it("maps rows to the chat-home contract with a collapsed bounded preview and assigned avatar colors", async () => {
    const home = await getChatHome(client([row()]) as never);
    expect(home.trips).toHaveLength(1);
    expect(home.trips[0]).toMatchObject({
      name: "Melaka crew", status: "ready", tripMode: "balanced", proposedBudgetTier: "standard", memberCount: 2,
      latestMessage: { preview: "see you at 9" },
    });
    expect(home.trips[0].memberAvatars[0]).toMatchObject({ displayName: "A" });
    expect(typeof home.trips[0].memberAvatars[0].color).toBe("string");
    expect(home.trips[0].unread).toBeNull();
  });
  it("keeps latestMessage null when there is no message", async () => {
    const home = await getChatHome(client([row({ latest_message_body: null, latest_message_at: null })]) as never);
    expect(home.trips[0].latestMessage).toBeNull();
  });
  it("caps avatars at CHAT_HOME_MAX_AVATARS", async () => {
    const many = Array.from({ length: 12 }, (_u, i) => ({ id: `1234567${i}-1234-4123-8123-1234567890ab`, displayName: `M${i}` }));
    const home = await getChatHome(client([row({ member_avatars: many })]) as never);
    expect(home.trips[0].memberAvatars).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `lib/repositories/chat-home.ts`.**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifiedUser } from "@/lib/supabase/auth";
import { databaseError } from "@/lib/http/errors";
import { colorForMemberIndex } from "@/lib/repositories/members";
import {
  chatHomeSchema, toLatestMessagePreview, CHAT_HOME_MAX_AVATARS, type ChatHome,
} from "@/lib/domain/chat-home";

const avatarRowSchema = z.object({ id: z.string().uuid(), displayName: z.string().min(1) });
const rpcRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(["draft", "ready"]),
  destination_name: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  trip_mode: z.string().nullable(),
  planned_duration_days: z.number().int().nullable(),
  proposed_budget_tier: z.string().nullable(),
  member_count: z.coerce.number().int(),
  member_avatars: z.array(avatarRowSchema),
  latest_message_body: z.string().nullable(),
  latest_message_at: z.string().nullable(),
});

export async function getChatHome(client: SupabaseClient): Promise<ChatHome> {
  await verifiedUser(client);
  const { data, error } = await client.rpc("chat_home");
  if (error) databaseError(error);

  const trips = ((data ?? []) as unknown[]).map((raw) => {
    const r = rpcRowSchema.parse(raw);
    const preview = r.latest_message_body ? toLatestMessagePreview(r.latest_message_body) : null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      destinationName: r.destination_name,
      startDate: r.start_date,
      endDate: r.end_date,
      tripMode: r.trip_mode,
      plannedDurationDays: r.planned_duration_days,
      proposedBudgetTier: r.proposed_budget_tier,
      memberCount: r.member_count,
      latestMessage: preview && r.latest_message_at
        ? { preview, at: new Date(r.latest_message_at).toISOString() }
        : null,
      memberAvatars: r.member_avatars
        .slice(0, CHAT_HOME_MAX_AVATARS)
        .map((a, index) => ({ ...a, color: colorForMemberIndex(index) })),
      unread: null,
    };
  });

  return chatHomeSchema.parse({ trips });
}
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(chats): getChatHome repository`.

---

## Task 3 — `app/api/chats/route.ts`

**Files:** Create `app/api/chats/route.ts`, `tests/api/chats.test.ts`.

- [ ] **Step 1: Write `tests/api/chats.test.ts` (RED)** — mock `@/lib/repositories/chat-home`
  and `@/lib/supabase/server` (`createClient` returning `{ rpc }`).

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getChatHome: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/repositories/chat-home", () => ({ getChatHome: mocks.getChatHome }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

import { GET, POST } from "@/app/api/chats/route";

const frame = {
  name: "Melaka crew", destinationName: "Melaka", tripMode: "balanced",
  startDate: "2026-12-12", endDate: "2026-12-14", proposedBudgetTier: null, splitAllowed: false,
};
const post = (body: unknown, origin = "https://trip.test") =>
  new Request("https://trip.test/api/chats", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

beforeEach(() => vi.resetAllMocks());

describe("GET /api/chats", () => {
  it("returns the caller's chat home, private no-store", async () => {
    mocks.getChatHome.mockResolvedValue({ trips: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ trips: [] });
  });
});

describe("POST /api/chats", () => {
  it("creates an organizer-framed trip and returns 201 with the id", async () => {
    mocks.rpc.mockResolvedValue({ data: "12345678-1234-4123-8123-123456789012", error: null });
    const res = await POST(post(frame));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ tripId: "12345678-1234-4123-8123-123456789012" });
    expect(mocks.rpc).toHaveBeenCalledWith("create_trip_group", expect.objectContaining({
      p_name: "Melaka crew", p_destination: "Melaka", p_trip_mode: "balanced",
      p_start_date: "2026-12-12", p_end_date: "2026-12-14", p_duration_days: null,
      p_proposed_budget_tier: null, p_split_allowed: false,
    }));
  });
  it("accepts a duration-only frame", async () => {
    mocks.rpc.mockResolvedValue({ data: "12345678-1234-4123-8123-123456789012", error: null });
    const res = await POST(post({ name: "x", destinationName: "Ipoh", tripMode: "relaxed", plannedDurationDays: 5 }));
    expect(res.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("create_trip_group", expect.objectContaining({ p_duration_days: 5, p_start_date: null }));
  });
  it("rejects a cross-origin request before the RPC", async () => {
    const res = await POST(post(frame, "https://evil.test"));
    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns 422 for a frame with neither dates nor duration", async () => {
    const res = await POST(post({ name: "x", destinationName: "Ipoh", tripMode: "relaxed" }));
    expect(res.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps the RPC 22023 to 422 and 42501 to 401", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect((await POST(post(frame))).status).toBe(422);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await POST(post(frame))).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `app/api/chats/route.ts`.**

```ts
import { createClient } from "@/lib/supabase/server";
import { getChatHome } from "@/lib/repositories/chat-home";
import { createTripFrameSchema } from "@/lib/domain/trip";
import { AppError, errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const home = await getChatHome(await createClient());
    return Response.json(home, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const frame = createTripFrameSchema.parse(await readJson(request));
    const client = await createClient();
    const { data, error } = await client.rpc("create_trip_group", {
      p_name: frame.name,
      p_destination: frame.destinationName,
      p_start_date: frame.startDate ?? null,
      p_end_date: frame.endDate ?? null,
      p_duration_days: frame.plannedDurationDays ?? null,
      p_trip_mode: frame.tripMode,
      p_proposed_budget_tier: frame.proposedBudgetTier,
      p_split_allowed: frame.splitAllowed,
    });
    if (error) {
      if (error.code === "42501") throw new AppError(401, "Please sign in to continue.", "UNAUTHENTICATED");
      if (error.code === "22023") throw new AppError(422, "That trip frame is not valid. Check the destination, mode, and dates.", "INVALID_TRIP_FRAME");
      throw new AppError(503, "The trip group could not be created. Please try again.", "STORAGE_UNAVAILABLE");
    }
    return Response.json({ tripId: data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(chats): GET/POST /api/chats`.

---

## Task 4 — `components/chat-home-view.tsx`

**Files:** Create `components/chat-home-view.tsx`, `tests/components/chat-home-view.test.tsx`.
Reuse `.app-shell`, `.section-heading`, `.field-hint`, `.primary-button`, `.secondary-button`,
`.error-notice`, `.segmented`, `.onboarding-*` chrome where it fits.

Behaviour:
- **Empty state:** heading "Your trip groups", text that there are none yet, a **Create your
  first trip group** button that opens the form.
- **List:** each row is a link to `/trips/<id>/chat` showing name, a destination/date (or
  "· 5-day trip" / "· dates to be set") summary, latest-message preview (or "No messages
  yet"), and up to 8 avatar initials. A `draft` row still links (the `/trips/[tripId]/chat`
  route tolerates it) but shows a "Planning locked until dates are set" hint.
- **Create form** (inline, toggled): `name` (text), `destinationName` (text), `tripMode`
  (`<select>` over `TRIP_MODES` / `TRIP_MODE_LABELS`), a **"I have dates" / "Just a rough
  length"** radio pair — dates → two `<input type=date>`; length → `<input type=number
  min=1 max=14>`. Optional: `proposedBudgetTier` (`<select>` incl. a "no preference" option
  → `null`), `splitAllowed` (`<input type=checkbox>`). Submit → `POST /api/chats` →
  on `201` `router.push('/trips/' + tripId + '/chat')`; on error show `.error-notice`.
  Client-side: disable submit until name + destination + mode + (both dates OR a length).

- [ ] **Step 1: Write `tests/components/chat-home-view.test.tsx` (RED)** covering: empty
  state renders the create CTA; a populated list renders a row linking to
  `/trips/<id>/chat` with the preview and a draft hint; the create form blocks submit until
  required fields are present; a valid date-pair submit POSTs the mapped body and navigates;
  a length submit POSTs `plannedDurationDays` with null dates; a `422` response surfaces an
  error and does not navigate.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `components/chat-home-view.tsx`** (client component, `useRouter`,
  `useState` for form visibility + fields + pending + error). Keep it a single file.
- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(chats): chat-group home view + organizer create form`.

---

## Task 5 — pages + root redirect

**Files:** Create `app/chats/page.tsx`, `app/trips/[tripId]/chat/page.tsx`; modify
`app/page.tsx`.

- [ ] **Step 1: Create `app/chats/page.tsx`.**

```tsx
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getChatHome } from "@/lib/repositories/chat-home";
import { ChatHomeView } from "@/components/chat-home-view";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");
  const home = await getChatHome(client);
  return <ChatHomeView trips={home.trips} />;
}
```

- [ ] **Step 2: Create `app/trips/[tripId]/chat/page.tsx`** — minimal; membership check
  WITHOUT `getTrip` (which rejects a draft's null dates). Slice 5 wraps this in the shared
  Chat/Plan/Timeline shell and redirects `/workspace` here.

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { ChatPane } from "@/features/chat/chat-pane";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TripChatPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;
  if (!z.string().uuid().safeParse(tripId).success) notFound();

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await client
    .from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();

  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return (
    <main className="app-shell">
      <div className="section-heading">
        <div><h1>Trip chat</h1></div>
        <Link className="secondary-button" href="/chats">All trip groups</Link>
      </div>
      <ChatPane tripId={tripId} selfMemberId={selfMemberId} members={members} />
    </main>
  );
}
```

- [ ] **Step 3: Modify `app/page.tsx`** — an authenticated `/` goes to `/chats` (spec §5).
  Remove the `TripSetupDashboard` render (the component + its test stay for Slice 5 to
  decide; nothing else imports it).

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login");
  redirect("/chats");
}
```

- [ ] **Step 4: Full sweep.** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`
  (`/chats`, `/trips/[tripId]/chat`, `/api/chats` must compile; `/` still builds).
- [ ] **Step 5: Commit** — `feat(chats): /chats home, /trips/[tripId]/chat, root redirect`.
- [ ] **Step 6: Update the umbrella plan** — tick Slice 3; record deviations (interim
  minimal `/trips/[tripId]/chat` route; `TripSetupDashboard` orphaned from `/` pending
  Slice 5; `chat_home()` function rather than a view). Not `docs/implementation-status.md`.

---

## Self-review

1. **Spec coverage:** §2.3 `/chats` home + empty state + membership-scoped list ordered by
   activity ✔ (T1, T4, T5); organizer create (destination + mode + dates-or-duration,
   optional budget/split) ✔ (T3, T4); selecting a group opens `/trips/[tripId]/chat` ✔
   (T5, minimal); one trip = one `trips` row / no `chat_groups` ✔ (uses `create_trip_group`);
   §5 `GET /api/chats` bounded metadata + `POST` → `201` ✔ (T1, T3); authenticated root →
   `/chats` ✔ (T5).
2. **Bounded reads:** `chat_home()` uses `left join lateral (… limit 1)` per trip and a
   `limit 8` avatar subquery — no unbounded message scan.
3. **Type/signature consistency:** `create_trip_group` params match the Slice 1 migration
   exactly; `chatHomeTripSchema` fields (Slice 1) populated 1:1; `getChatHome` returns
   `ChatHome`.
4. **Isolation:** `chat_home()` is `security invoker`; `trips` RLS
   (`owner_user_id = auth.uid() or is_trip_member(id)`) scopes it; `/trips/[tripId]/chat`
   checks `trip_members` before rendering.
