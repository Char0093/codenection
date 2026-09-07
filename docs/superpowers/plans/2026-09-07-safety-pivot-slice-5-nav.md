# Slice 5 — selected-trip navigation consolidation (safety-first pivot)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD. Umbrella:
> `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`. Spec:
> `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md` §2.3;
> revised `Implementation_Plan.md` Task 3.0a.

**Goal:** One shared selected-trip shell with **Chat / Plan / Timeline** (plus **Your prefs**)
navigation and a visible route back to `/chats`. Chat is the default surface. The
`WorkspaceShell` no longer carries its own duplicate "Timeline jigsaw" toggle. Legacy
`/trips/[tripId]/workspace` redirects into the shell. Plan and Timeline are locked until the
trip has a valid date range (`status = 'ready'`).

**Consumes:** `ChatPane` (`@/features/chat/chat-pane`), `TimelinePane`
(`@/features/timeline/timeline-pane`), `WorkspaceClient` (`@/features/workspace/workspace-client`),
`MemberEntryPanel` (Slice 4), `getMyMemberEntryContext` (Slice 4),
`tripRepository().getTrip` (works for `ready` trips), `listTripMembers` /
`colorForMemberIndex`, `createClient`, `isSupabaseConfigured`.

**Produces:**
- `app/trips/[tripId]/layout.tsx` — auth + membership gate (draft-tolerant) + the shared shell.
- `components/trip-shell.tsx` — `TripShell({ tripId, tripName, ready, children })` client
  nav (`usePathname` for the active item).
- `app/trips/[tripId]/page.tsx` (→ `chat`), `app/trips/[tripId]/plan/page.tsx`,
  `app/trips/[tripId]/timeline/page.tsx`; trimmed `chat/page.tsx` + `entry/page.tsx`;
  `workspace/page.tsx` → redirect.
- `WorkspaceShell({ mapSlot, chatSlot })` — bar + jigsaw toggle removed.

---

## Task 1 — `WorkspaceShell` slim-down

**Files:** Modify `features/workspace/workspace-shell.tsx`,
`features/workspace/workspace-client.tsx`; rewrite `tests/components/workspace-shell.test.tsx`;
edit `tests/components/workspace-client.test.tsx`.

- [ ] **Step 1: Rewrite `tests/components/workspace-shell.test.tsx` (RED).** Drop the
  `tripName` / `blocks` props and the "still opens the pre-trip jigsaw" case; keep the three
  layout cases, now rendering `<WorkspaceShell mapSlot={<div aria-label="Spatial map" />}
  chatSlot={<div aria-label="Group chat" />} />` — wait, the shell wraps slots in
  `<section aria-label="Spatial map">` / `"Group chat"` itself, so pass bare `<div />` slots
  and keep asserting `getByLabelText("Spatial map")` / `"Group chat"`. Assert
  `screen.queryByRole("button", { name: /jigsaw/i })` is **null**.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Edit `features/workspace/workspace-shell.tsx`.** New shape:

```tsx
"use client";

import { Map as MapIcon, MessageSquare } from "lucide-react";
import React, { useEffect, useState } from "react";

export type WorkspaceShellProps = {
  /** The 3D spatial map. Injected so the shell stays renderable without a Mapbox token. */
  mapSlot?: React.ReactNode;
  /** The realtime group chat. */
  chatSlot?: React.ReactNode;
};

const TABLET_BREAKPOINT_QUERY = "(max-width: 768px)";

function usePanesCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(TABLET_BREAKPOINT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setCollapsed(event.matches);
    setCollapsed(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return collapsed;
}

/**
 * The dual-layer contextual surface: a 3D spatial map on top, the collaborative chatroom
 * below. Below the tablet breakpoint the two panes collapse into tabs. The pre-trip Timeline
 * jigsaw is now its own nav destination (see `components/trip-shell.tsx`), not a toggle here.
 */
export function WorkspaceShell({ mapSlot, chatSlot }: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useState<"map" | "chat">("map");
  const collapsed = usePanesCollapsed();

  const mapPane = (
    <section className="workspace-map" aria-label="Spatial map">
      {mapSlot ?? (
        <div className="workspace-placeholder">
          <MapIcon size={20} aria-hidden />
          <p>3D map loads once a Mapbox token is configured.</p>
        </div>
      )}
    </section>
  );
  const chatPane = (
    <section className="workspace-chat" aria-label="Group chat">
      {chatSlot ?? (
        <div className="workspace-placeholder">
          <MessageSquare size={20} aria-hidden />
          <p>Group chat appears here.</p>
        </div>
      )}
    </section>
  );

  return (
    <div className="workspace">
      {collapsed ? (
        <div className="workspace-collapsed">
          <div className="workspace-pane-tabs" role="tablist" aria-label="Workspace pane">
            {(["map", "chat"] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={activeTab === tab}
                tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)}>
                {tab === "map" ? <MapIcon size={14} aria-hidden /> : <MessageSquare size={14} aria-hidden />}
                {tab === "map" ? "Map" : "Chat"}
              </button>
            ))}
          </div>
          {activeTab === "map" ? mapPane : chatPane}
        </div>
      ) : (
        <div className="workspace-panes">
          {mapPane}
          {chatPane}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Edit `features/workspace/workspace-client.tsx`.** Drop the `tripName` prop;
  render `<WorkspaceShell mapSlot={mapSlot} chatSlot={<ChatPane … />} />` (no `tripName`,
  `members`, `blocks`). Keep `needsOnboarding` + `<TravelDnaNudge>` untouched (Slice 6/7
  retires the trip-scoped nudge). Update `tests/components/workspace-client.test.tsx`: remove
  `tripName: "KL"` from `base`.

- [ ] **Step 5: Run both tests — expect PASS.** `npx tsc --noEmit` (the old
  `workspace/page.tsx` still passes `tripName` / `blocks` — it is replaced in Task 3;
  if typecheck breaks there first, do Task 3's `workspace/page.tsx` redirect now).
- [ ] **Step 6: Commit** — `refactor(workspace): drop the shell's title bar + jigsaw toggle`.

---

## Task 2 — the shared shell (`layout.tsx` + `TripShell`)

**Files:** Create `app/trips/[tripId]/layout.tsx`, `components/trip-shell.tsx`,
`tests/components/trip-shell.test.tsx`. Add a small CSS block.

- [ ] **Step 1: Write `tests/components/trip-shell.test.tsx` (RED).** Mock `next/navigation`
  `usePathname`.

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripShell } from "@/components/trip-shell";

const pathname = vi.fn(() => "/trips/t1/chat");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
afterEach(cleanup);

const tripId = "t1";

describe("TripShell", () => {
  it("links Chat / Your prefs and a route back to the group list, and marks the active item", () => {
    render(<TripShell tripId={tripId} tripName="Melaka crew" ready><div>body</div></TripShell>);
    expect(screen.getByRole("link", { name: /all trip groups/i })).toHaveAttribute("href", "/chats");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/trips/t1/chat");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/trips/t1/plan");
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/trips/t1/timeline");
    expect(screen.getByRole("link", { name: /your prefs/i })).toHaveAttribute("href", "/trips/t1/entry");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("locks Plan and Timeline until the trip is ready", () => {
    render(<TripShell tripId={tripId} tripName="Someday" ready={false}><div /></TripShell>);
    expect(screen.queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Timeline" })).not.toBeInTheDocument();
    expect(screen.getByText("Plan")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Timeline")).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `components/trip-shell.tsx`.**

```tsx
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { key: "chat", label: "Chat", needsReady: false },
  { key: "plan", label: "Plan", needsReady: true },
  { key: "timeline", label: "Timeline", needsReady: true },
  { key: "entry", label: "Your prefs", needsReady: false },
] as const;

export function TripShell({ tripId, tripName, ready, children }: {
  tripId: string;
  tripName: string;
  ready: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <main className="app-shell trip-shell">
      <div className="section-heading">
        <div><h1>{tripName}</h1></div>
        <Link className="secondary-button" href="/chats">All trip groups</Link>
      </div>
      <nav className="trip-nav" aria-label="Trip sections">
        {ITEMS.map((item) => {
          const href = `/trips/${tripId}/${item.key}`;
          const active = pathname === href;
          if (item.needsReady && !ready) {
            return (
              <span key={item.key} className="trip-nav-item" aria-disabled="true"
                title="Add trip dates to unlock planning">
                {item.label}
              </span>
            );
          }
          return (
            <Link key={item.key} href={href} className="trip-nav-item"
              aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="workspace-main">{children}</div>
    </main>
  );
}
```

- [ ] **Step 4: Create `app/trips/[tripId]/layout.tsx`.**

```tsx
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { TripShell } from "@/components/trip-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TripLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;
  if (!z.string().uuid().safeParse(tripId).success) notFound();

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership }, { data: trip }] = await Promise.all([
    client.from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle(),
    client.from("trips").select("name,status").eq("id", tripId).maybeSingle(),
  ]);
  if (!membership || !trip) notFound();

  return (
    <TripShell tripId={tripId} tripName={(trip as { name: string }).name} ready={(trip as { status: string }).status === "ready"}>
      {children}
    </TripShell>
  );
}
```

- [ ] **Step 5: Add CSS** to `app/globals.css`:

```css
.trip-shell { max-width: 900px; margin: 0 auto; }
.trip-nav { display: flex; gap: 4px; margin: 0 0 18px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.trip-nav-item { display: inline-flex; align-items: center; min-height: 40px; padding: 8px 14px; border-bottom: 2px solid transparent; color: var(--muted); font-size: 13px; font-weight: 600; text-decoration: none; }
.trip-nav-item[aria-current="page"] { color: var(--teal-dark); border-bottom-color: var(--teal); }
.trip-nav-item[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
```

- [ ] **Step 6: Run `tests/components/trip-shell.test.tsx` — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `feat(trip): shared selected-trip shell (Chat / Plan / Timeline / prefs)`.

---

## Task 3 — the routes

**Files:** Create `app/trips/[tripId]/page.tsx`, `app/trips/[tripId]/plan/page.tsx`,
`app/trips/[tripId]/timeline/page.tsx`; rewrite `app/trips/[tripId]/workspace/page.tsx`,
`app/trips/[tripId]/chat/page.tsx`, `app/trips/[tripId]/entry/page.tsx`.

All of these render **inside** `layout.tsx`, so they drop their own `<main className="app-shell">`
+ `.section-heading` + "All trip groups" link (the shell provides them). The layout already
did the auth + membership gate.

- [ ] **Step 1: `app/trips/[tripId]/page.tsx`**

```tsx
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function TripIndex({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/chat`);
}
```

- [ ] **Step 2: Trim `app/trips/[tripId]/chat/page.tsx`** to just the content:

```tsx
import { redirect } from "next/navigation";
import { ChatPane } from "@/features/chat/chat-pane";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TripChatPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return <ChatPane tripId={tripId} selfMemberId={selfMemberId} members={members} />;
}
```

- [ ] **Step 3: Trim `app/trips/[tripId]/entry/page.tsx`** — drop `<main>` / heading / the
  back link; render `<MemberEntryPanel tripId={tripId} initial={initial} />` after the
  membership-guarded `getMyMemberEntryContext` (keep the `try/catch → notFound`).

- [ ] **Step 4: `app/trips/[tripId]/plan/page.tsx`** — the map+chat workspace, only for a
  `ready` trip.

```tsx
import { notFound, redirect } from "next/navigation";
import { WorkspaceClient } from "@/features/workspace/workspace-client";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import { tripRepository } from "@/lib/repositories/server";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TripPlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await client.from("trips").select("status").eq("id", tripId).maybeSingle();
  if (!trip) notFound();
  if ((trip as { status: string }).status !== "ready") {
    return (
      <div className="empty-state">
        <h2>Planning is locked</h2>
        <p>Add a destination and a start and end date to this trip to start planning.</p>
      </div>
    );
  }

  const record = await (await tripRepository()).getTrip(tripId);
  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return (
    <WorkspaceClient
      tripId={record.id}
      members={members}
      selfMemberId={selfMemberId}
      canDecideProposals={record.role === "owner"}
      initialActiveProposalId={record.activeProposalId}
      mapSlot={<TimelinePane tripId={record.id} startDate={record.startDate} endDate={record.endDate} revision={record.revision} />}
      needsOnboarding={false}
    />
  );
}
```

- [ ] **Step 5: `app/trips/[tripId]/timeline/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import { tripRepository } from "@/lib/repositories/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TripTimelinePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await client.from("trips").select("status").eq("id", tripId).maybeSingle();
  if (!trip) notFound();
  if ((trip as { status: string }).status !== "ready") {
    return (
      <div className="empty-state">
        <h2>Timeline is locked</h2>
        <p>Add a destination and trip dates to open the timeline.</p>
      </div>
    );
  }

  const record = await (await tripRepository()).getTrip(tripId);
  return <TimelinePane tripId={record.id} startDate={record.startDate} endDate={record.endDate} revision={record.revision} />;
}
```

- [ ] **Step 6: `app/trips/[tripId]/workspace/page.tsx`** → redirect into the shell:

```tsx
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function LegacyWorkspace({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/plan`);
}
```

- [ ] **Step 7: Full sweep** — `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.
  Expect the old `workspace/page.tsx` deps (`getOnboardingNeeded`) to be unused now — remove
  any now-dead imports the sweep flags.
- [ ] **Step 8: Commit** — `feat(trip): Chat/Plan/Timeline routes + /workspace redirect`.

---

## Task 4 — retire the dead-end dashboard

**Files:** Delete `components/trip-setup-dashboard.tsx`,
`tests/components/trip-setup-dashboard.test.tsx`; edit `tests/browser/main.tsx`.

`components/trip-setup-dashboard.tsx` is unreferenced after Slice 3 (`app/page.tsx` →
`/chats`). Its only importers are its own test and the Playwright harness `tests/browser/main.tsx`.

- [ ] **Step 1: Delete the component + its test.**
- [ ] **Step 2: Edit `tests/browser/main.tsx`** — replace the `TripSetupDashboard` branch with
  `<ChatHomeView trips={[]} />` (import from `@/components/chat-home-view`), or render
  `<LoginForm configured={false} />` unconditionally. Keep it compiling.
- [ ] **Step 3: Full sweep** — `npx tsc --noEmit`, `npm run lint`, `npm test` (count drops by
  ~26), `npm run build`.
- [ ] **Step 4: Commit** — `chore(trip): retire the orphaned trip-setup dashboard`.
- [ ] **Step 5: Update the umbrella plan** — tick Slice 5; note the deviations (dashboard
  deleted; `getOnboardingNeeded` / trip-scoped nudge still referenced by `WorkspaceClient`
  pending Slice 6/7; `entry` added as a 4th nav item beyond the spec's Chat/Plan/Timeline).

---

## Self-review

1. **Spec coverage:** §2.3 one shared Chat/Plan/Timeline nav ✔ (T2); Chat default ✔ (T3
   index redirect); duplicate standalone workspace/jigsaw entry points retired ✔ (T1 shell
   toggle removed, T4 dashboard deleted); planning/generation only when the frame is valid ✔
   (T2 locks Plan/Timeline, T3 pages guard on `status`); a visible route back to the group
   list on every selected-trip screen ✔ (T2 shell "All trip groups"); legacy `/workspace`
   redirects ✔ (T3).
2. **Type consistency:** `WorkspaceShell` props reduced to `{ mapSlot, chatSlot }` everywhere;
   `WorkspaceClient` drops `tripName`; the shell/layout `ready` boolean === `status === 'ready'`.
3. **Guards:** the layout is the single auth + membership gate for all `/trips/[tripId]/*`
   pages; child pages keep only their own data fetches. `getTrip` is called only after a
   `status === 'ready'` check, so a draft trip never hits `persistedTripSchema`.
