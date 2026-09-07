# Slice 4 — pre-join preview + member entry + alignment summary (safety-first pivot)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD. Umbrella:
> `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`. Spec:
> `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md` §2.4, §3.3, §6.

**Goal:** A trip member sees the organizer's frame (a **preview**), submits their **per-trip
entry** (availability, budget tier, pace, and per-trip confirm/override of their saved safety
requirements), and — once ≥2 members have entered — sees an **aggregate, non-attributable
alignment summary**. Invitation send/accept stays deferred (spec §8): the entry is filled by
members who already joined (the organizer first); the boundary is fixed for the future join
flow, which will require an entry row before creating the `trip_members` row.

**Consumes (Slice 1):** `trip_member_entries` table, `submit_member_entry(uuid, jsonb)`,
`trip_alignment_summary(uuid)` (SECURITY DEFINER, aggregate-only, null below 2 entries);
`memberEntrySchema` / `MemberEntry` / `FlagRef` / `alignmentSummarySchema` / `AlignmentSummary`
(`@/lib/domain/member-entry`); `tripPreviewSchema` / `TripPreview` (`@/lib/domain/trip-preview`);
`trips.{trip_mode,planned_duration_days,proposed_budget_tier}`.
**Consumes (existing):** `verifiedUser`, `createClient`, `AppError` / `databaseError` /
`errorResponse`, `readJson` / `requireSameOrigin`, `*FLAG_LABELS` (`@/lib/domain/constraints`),
`isSupabaseConfigured`. `trips` / `trip_members` / `user_travel_constraints` RLS all permit a
member to read their own trip's frame + membership and their own global constraints.

**Produces (Slice 5 relies on):**
- `app/actions/member-entry.ts`: `getMyMemberEntryContext(tripId): Promise<MemberEntryContext>`;
  `submitMyMemberEntry(tripId, rawBody): Promise<{ ok: true }>`.
- `app/api/trips/[tripId]/member-entry/route.ts`: `GET` (context, `private, no-store`) /
  `POST` (same-origin) → `{ ok: true }` `200`.
- `components/member-entry-panel.tsx`: `MemberEntryPanel({ tripId, initial: MemberEntryContext })`.
- `app/trips/[tripId]/entry/page.tsx`; a link to it from `app/trips/[tripId]/chat/page.tsx`.

**Explicitly deferred (own follow-up sub-slice):** destination-specific candidate POI-card
ratings (spec §2.4 last clause). It needs the region/recommender infra (`inferPoiRegion`,
`poi_catalog`, `buildChoicePool`) and a ratings store, and only applies to a `ready` trip.
Noted in the umbrella plan.

---

## Task 1 — `app/actions/member-entry.ts`

**Files:** Create `app/actions/member-entry.ts`, `tests/actions/member-entry.test.ts`.

**Type produced:**
```ts
export type MemberEntryContext = {
  preview: TripPreview;
  savedSafety: FlagRef[];            // the caller's active, confirmed global constraints
  entry: MemberEntry | null;         // the caller's current per-trip entry, if any
  alignment: AlignmentSummary | null;// aggregate, or null below the 2-entry floor
};
```

- [ ] **Step 1: Write `tests/actions/member-entry.test.ts` (RED).** Stub `@/lib/supabase/server`
  `createClient` with a fake exposing `auth.getUser`, `.from(table)` builders, and `.rpc`.
  Cover:
  - `getMyMemberEntryContext` assembles `preview` (organizer display name from the
    `role='owner'` member, destination/dates/duration/proposedBudgetTier/pace from the trip,
    `memberCount` from the member rows), `savedSafety` (rows from `user_travel_constraints`
    where `retired_at is null and confirmed_at is not null`), `entry` (mapped from the
    caller's `trip_member_entries` row or `null`), and `alignment` (the `trip_alignment_summary`
    RPC result or `null`).
  - a non-member (`trips` select returns no row) → `AppError(403, …, "FORBIDDEN")`.
  - `submitMyMemberEntry` parses the body with `memberEntrySchema`, calls
    `rpc("submit_member_entry", { p_trip_id, p_entry })`, and maps RPC `42501 → 403`,
    `22023 → 422`; returns `{ ok: true }` on success.
  - a malformed body rejects before the RPC.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `app/actions/member-entry.ts`.**

```ts
"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { memberEntrySchema, alignmentSummarySchema, type MemberEntry, type FlagRef, type AlignmentSummary } from "@/lib/domain/member-entry";
import { tripPreviewSchema, type TripPreview } from "@/lib/domain/trip-preview";

const tripIdSchema = z.string().uuid();

export type MemberEntryContext = {
  preview: TripPreview;
  savedSafety: FlagRef[];
  entry: MemberEntry | null;
  alignment: AlignmentSummary | null;
};

const flagRefRowSchema = z.object({
  kind: z.enum(["dietary", "religious_access", "mobility"]),
  flag: z.string().min(1),
});

function mapEntryRow(row: {
  availability_coverage: string; arrival_date: string | null; departure_date: string | null;
  budget_tier: string; pace: string; safety_overrides: unknown;
} | null): MemberEntry | null {
  if (!row) return null;
  return memberEntrySchema.parse({
    availability: {
      coverage: row.availability_coverage,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
    },
    budgetTier: row.budget_tier,
    pace: row.pace,
    safetyOverrides: Array.isArray(row.safety_overrides) ? row.safety_overrides : [],
  });
}

export async function getMyMemberEntryContext(tripId: string): Promise<MemberEntryContext> {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  const user = await verifiedUser(client);

  const [{ data: trip, error: tripError }, { data: memberRows, error: memberError }] = await Promise.all([
    client.from("trips")
      .select("id,destination_name,start_date,end_date,planned_duration_days,proposed_budget_tier,pace")
      .eq("id", tripId).maybeSingle(),
    client.from("trip_members").select("user_id,display_name,role").eq("trip_id", tripId),
  ]);
  if (tripError) databaseError(tripError);
  if (memberError) databaseError(memberError);
  if (!trip || !memberRows?.some((m) => m.user_id === user.id)) {
    throw new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  }

  const organizer = memberRows.find((m) => m.role === "owner");
  const preview = tripPreviewSchema.parse({
    organizerName: organizer?.display_name ?? "The organizer",
    destinationName: trip.destination_name,
    startDate: trip.start_date,
    endDate: trip.end_date,
    plannedDurationDays: trip.planned_duration_days,
    memberCount: memberRows.length,
    proposedBudgetTier: trip.proposed_budget_tier,
    pace: trip.pace ?? null,
  });

  const [{ data: entryRow, error: entryError }, { data: constraintRows, error: constraintError }, { data: alignmentData, error: alignmentError }] = await Promise.all([
    client.from("trip_member_entries")
      .select("availability_coverage,arrival_date,departure_date,budget_tier,pace,safety_overrides")
      .eq("trip_id", tripId).eq("user_id", user.id).maybeSingle(),
    client.from("user_travel_constraints")
      .select("kind,flag").is("retired_at", null).not("confirmed_at", "is", null),
    client.rpc("trip_alignment_summary", { p_trip_id: tripId }),
  ]);
  if (entryError) databaseError(entryError);
  if (constraintError) databaseError(constraintError);
  if (alignmentError) databaseError(alignmentError);

  const savedSafety = (constraintRows ?? [])
    .map((row) => flagRefRowSchema.safeParse(row))
    .filter((r): r is { success: true; data: FlagRef } => r.success)
    .map((r) => r.data);

  const alignment = alignmentData ? alignmentSummarySchema.parse(alignmentData) : null;

  return { preview, savedSafety, entry: mapEntryRow(entryRow), alignment };
}

function mapRpcError(error: { code?: string }): AppError {
  if (error.code === "42501") return new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  if (error.code === "22023") return new AppError(422, "Some of your trip answers were invalid. Please review and resubmit.", "INVALID_MEMBER_ENTRY");
  try { databaseError(error); } catch (mapped) { return mapped as AppError; }
  return new AppError(503, "Trip entry is temporarily unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export async function submitMyMemberEntry(tripId: string, rawBody: unknown): Promise<{ ok: true }> {
  tripIdSchema.parse(tripId);
  const entry = memberEntrySchema.parse(rawBody);
  const client = await createClient();
  await verifiedUser(client);
  const { error } = await client.rpc("submit_member_entry", { p_trip_id: tripId, p_entry: entry });
  if (error) throw mapRpcError(error);
  return { ok: true };
}
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(trip): member-entry context + submit actions`.

---

## Task 2 — `app/api/trips/[tripId]/member-entry/route.ts`

**Files:** Create the route + `tests/api/member-entry.test.ts` (mock the action module).

- [ ] **Step 1: Write the test (RED)** — GET returns the context with `private, no-store`;
  POST same-origin calls `submitMyMemberEntry` with `(tripId, body)` and returns `200
  { ok: true }`; cross-origin POST → `403` before the action; an action `AppError(422)` →
  `422`; a non-uuid `tripId` → `422` (Zod).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create the route** (mirror `constraints/route.ts`).

```ts
import { z } from "zod";
import { getMyMemberEntryContext, submitMyMemberEntry } from "@/app/actions/member-entry";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Context) {
  try {
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const data = await getMyMemberEntryContext(tripId);
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const result = await submitMyMemberEntry(tripId, await readJson(request));
    return Response.json(result, { status: 200 });
  } catch (error) { return errorResponse(error); }
}
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(trip): GET/POST /api/trips/[tripId]/member-entry`.

---

## Task 3 — `components/member-entry-panel.tsx`

**Files:** Create the component + `tests/components/member-entry-panel.test.tsx`. Reuse
`.app-shell`, `.section-heading`, `.field-hint`, `.segmented`, `.flag-grid`, `.flag-chip`,
`.error-notice`, `.primary-button`, `.onboarding-nav`, plus a small block of new CSS.

Sections, top to bottom:
1. **Trip preview card** — organizer, destination, a dates-or-`N-day trip` line, member
   count, proposed budget (or "not set"), pace.
2. **Alignment summary** — only when `initial.alignment` is non-null. A short "Aggregated
   across N members — not attributed to anyone" caption, then: budget range (min–max), a
   pace bar/row (`relaxed n · balanced n · …`), availability (`full n / partial n`), and any
   safety-override counts (`halal dropped by 1`, etc.). Never renders a name.
3. **Your entry form**:
   - Availability: radios `Whole trip` / `Part of it`; when "part", two `type=date` inputs
     (`Arrive` / `Leave`) — at least one required.
   - Budget tier: `<select>` over `budgetTiers`.
   - Pace: `<select>` over `paceLevels`.
   - Saved safety: for each `initial.savedSafety` flag, a checkbox **"Applies to this trip"**
     defaulting checked (or from `initial.entry.safetyOverrides` when re-editing —
     unchecked === present in `safetyOverrides`). Unchecking marks it as a per-trip override.
     If `savedSafety` is empty, show "No saved safety requirements."
   - Submit → `POST /api/trips/<id>/member-entry` with a `memberEntrySchema`-shaped body
     (`safetyOverrides` = the *unchecked* saved flags). On `200`, show a "Saved" confirmation
     and call an optional `onSaved?()`. On error, `.error-notice`.

- [ ] **Step 1: Write `tests/components/member-entry-panel.test.tsx` (RED)** covering:
  renders the preview (organizer + destination + member count); hides the alignment section
  when `alignment` is null and shows it with no member identifiers when present; blocks
  submit until availability is valid (part-trip needs a date); a full-trip submit POSTs
  `{ availability: { coverage: "full", … }, budgetTier, pace, safetyOverrides: [] }`;
  unchecking a saved safety flag puts it in `safetyOverrides`; a server `422` surfaces an
  error and no "Saved".

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `components/member-entry-panel.tsx`** (single client file,
  `useState` for form + pending + error + saved). Add the CSS block to `app/globals.css`.
- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`; `npm run lint`.
- [ ] **Step 5: Commit** — `feat(trip): member-entry panel (preview + alignment + form)`.

---

## Task 4 — `app/trips/[tripId]/entry/page.tsx` + link + sweep

**Files:** Create the page; modify `app/trips/[tripId]/chat/page.tsx` to link to it.

- [ ] **Step 1: Create `app/trips/[tripId]/entry/page.tsx`** (mirror the chat page's
  membership guard; no `getTrip`).

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { MemberEntryPanel } from "@/components/member-entry-panel";
import { getMyMemberEntryContext } from "@/app/actions/member-entry";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TripEntryPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;
  if (!z.string().uuid().safeParse(tripId).success) notFound();

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  let initial;
  try {
    initial = await getMyMemberEntryContext(tripId);
  } catch {
    notFound();
  }

  return (
    <main className="app-shell">
      <div className="section-heading">
        <div><h1>Your trip preferences</h1></div>
        <Link className="secondary-button" href={`/trips/${tripId}/chat`}>Back to chat</Link>
      </div>
      <MemberEntryPanel tripId={tripId} initial={initial} />
    </main>
  );
}
```

- [ ] **Step 2: Modify `app/trips/[tripId]/chat/page.tsx`** — add a
  `<Link className="secondary-button" href={\`/trips/${tripId}/entry\`}>Your trip preferences</Link>`
  next to the existing "All trip groups" link.

- [ ] **Step 3: Full sweep** — `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`
  (`/trips/[tripId]/entry`, `/api/trips/[tripId]/member-entry` compile).
- [ ] **Step 4: Commit** — `feat(trip): /trips/[tripId]/entry page + chat link`.
- [ ] **Step 5: Update the umbrella plan** — tick Slice 4; record deviations (standalone
  `/entry` page pending Slice 5's shell; POI candidate-card ratings deferred to a follow-up).

---

## Self-review

1. **Spec coverage:** §2.4 preview (organizer, destination, dates, member count, proposed
   budget, pace) ✔ (T1, T3); per-trip inputs (availability, budget, pace, safety
   confirm/override) ✔ (T3); aggregate non-attributable alignment summary ✔ (T1 via the
   Slice-1 SECURITY DEFINER fn; T3 renders it with no identifiers); §6 "APIs do not return
   another member's raw answers" ✔ (`trip_alignment_summary` is aggregate-only; the action
   reads only the caller's own entry + constraints). POI candidate ratings — deferred, noted.
2. **Type consistency:** body POSTed matches `memberEntrySchema`; `submit_member_entry` /
   `trip_alignment_summary` params match the Slice 1 migration; `TripPreview` /
   `AlignmentSummary` / `FlagRef` used verbatim.
3. **Isolation:** `getMyMemberEntryContext` 403s a non-member before returning anything;
   `trip_member_entries` self-only RLS; the alignment fn re-checks membership + the 2-entry
   floor.
