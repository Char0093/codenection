# Slice 2 — first-login gate + global onboarding (safety-first pivot)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD: RED → GREEN
> → commit. Steps are `- [ ]`. Umbrella:
> `docs/superpowers/plans/2026-09-07-travel-dna-safety-pivot.md`. Spec:
> `docs/superpowers/specs/2026-09-06-first-login-travel-dna-chat-groups-design.md` §2.1–2.2,
> §5, §6. Supersedes `2026-09-06-first-login-task4-5-subplan.md`.

**Goal:** After first authenticated login, an incomplete user is redirected to `/onboarding`;
they complete a ~10-second safety check (safety-vault screen + one optional exploration dial)
that submits through a same-origin, revision-checked global RPC and lands them back where
they were headed (interim `/`; Slice 3 makes the default `/chats`). A completed user is never
gated again and can edit at `/preferences`.

**Consumes (Slice 1):** `lib/domain/onboarding.ts` — `onboardingAnswersSchema`,
`submitBodySchema`, `OnboardingSnapshot` (`profile: { travelVibe, serendipityEpsilon,
onboardingCompletedAt } | null`), `epsilonToSurpriseDial`, `SURPRISE_DIAL_DEFAULT`,
`dealbreakersSchema`. DB: `submit_user_onboarding(bigint, jsonb)`, `user_travel_profiles`,
`user_travel_constraints`.

**Consumes (existing):** `verifiedUser` (`@/lib/supabase/auth`), `createClient`
(`@/lib/supabase/server`), `isSupabaseConfigured` (`@/lib/supabase/config`),
`safeRedirectPath` (`@/lib/supabase/redirect`), `AppError` / `databaseError` /
`errorResponse` (`@/lib/http/errors`), `readJson` / `requireSameOrigin`
(`@/lib/http/request`), `DIETARY_FLAGS` etc. + `*FlagSchema` (`@/lib/domain/constraints`).
The five-screen `components/onboarding-wizard.tsx` + `app/actions/onboarding.ts` +
`/api/trips/[tripId]/onboarding` are the frozen compat flow — **do not touch them**.

**Produces (Slice 3+ rely on):**
- `lib/onboarding/gate.ts`: `isGateExempt(path: string): boolean`;
  `isOnboardingComplete(client): Promise<boolean>` (fail-open on a DB error).
- `app/actions/user-onboarding.ts`: `getMyUserOnboarding(): Promise<OnboardingSnapshot>`;
  `getUserOnboardingComplete(): Promise<boolean>`;
  `submitUserOnboarding(rawBody: unknown): Promise<{ profileRevision: number; needsOnboarding: false }>`.
- `app/api/onboarding/route.ts`: `GET` (snapshot, `private, no-store`) / `POST` (same-origin,
  `200`). Gate-exempt.
- `components/user-onboarding-wizard.tsx`: `UserOnboardingWizard({ initial: OnboardingSnapshot,
  successHref: string, endpoint?: string /* default "/api/onboarding" */ })`.
- `app/onboarding/page.tsx`, `app/preferences/page.tsx`.

---

## Task 1 — `lib/onboarding/gate.ts`

**Files:** Create `lib/onboarding/gate.ts`, `tests/lib/onboarding-gate.test.ts`.

- [ ] **Step 1: Write `tests/lib/onboarding-gate.test.ts` (RED).**

```ts
import { describe, expect, it, vi } from "vitest";
import { isGateExempt, isOnboardingComplete } from "@/lib/onboarding/gate";

describe("isGateExempt", () => {
  it.each(["/api/onboarding", "/api/trips/x", "/onboarding", "/onboarding/step/2"])("is true for %s", (p) => {
    expect(isGateExempt(p)).toBe(true);
  });
  it.each(["/", "/preferences", "/chats", "/trips/abc/workspace", "/login", "/auth/callback"])("is false for %s", (p) => {
    expect(isGateExempt(p)).toBe(false);
  });
});

describe("isOnboardingComplete", () => {
  const client = (result: { data: unknown; error: unknown }) => ({
    from: () => ({ select: () => ({ maybeSingle: async () => result }) }),
  });
  it("is true only when a row carries a non-null onboarding_completed_at", async () => {
    expect(await isOnboardingComplete(client({ data: { onboarding_completed_at: "2026-09-07T00:00:00Z" }, error: null }))).toBe(true);
    expect(await isOnboardingComplete(client({ data: { onboarding_completed_at: null }, error: null }))).toBe(false);
    expect(await isOnboardingComplete(client({ data: null, error: null }))).toBe(false);
  });
  it("fails open (true) on a database error so a blip cannot trap users at /onboarding", async () => {
    expect(await isOnboardingComplete(client({ data: null, error: { code: "503" } }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/lib/onboarding-gate.test.ts`).

- [ ] **Step 3: Create `lib/onboarding/gate.ts`.**

```ts
/** Paths the first-login onboarding gate must never redirect. `/login` + `/auth/*` are
 *  already handled as `publicRoute` in middleware; this covers the rest so the gate can
 *  neither loop nor block the flow that completes onboarding. */
export function isGateExempt(path: string): boolean {
  return path.startsWith("/api/")
    || path === "/onboarding"
    || path.startsWith("/onboarding/");
}

type MinimalClient = { from: (table: string) => any };

/** True when the caller has a completed global Travel DNA profile. Self-only RLS makes this
 *  a single-row PK lookup. A missing row or null timestamp means "not done". A DB error
 *  fails OPEN (returns true): a transient blip must not strand a completed user at
 *  /onboarding, and the submit RPC still CAS-checks. */
export async function isOnboardingComplete(client: MinimalClient): Promise<boolean> {
  const { data, error } = await client
    .from("user_travel_profiles")
    .select("onboarding_completed_at")
    .maybeSingle();
  if (error) return true;
  return data?.onboarding_completed_at != null;
}
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(onboarding): first-login gate helpers`.

---

## Task 2 — `app/actions/user-onboarding.ts` + `/api/onboarding`

**Files:** Create `app/actions/user-onboarding.ts`, `app/api/onboarding/route.ts`,
`tests/actions/user-onboarding-error-mapping.test.ts`, `tests/api/user-onboarding.test.ts`.

**Interfaces produced:** see header.

- [ ] **Step 1: Write `tests/actions/user-onboarding-error-mapping.test.ts` (RED)** — mirrors
  `tests/actions/onboarding-error-mapping.test.ts`, no action mock, Supabase stubbed.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const { rpcMock, stubClient } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  return {
    rpcMock,
    stubClient: { auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) }, rpc: rpcMock },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => stubClient }));

import { submitUserOnboarding } from "@/app/actions/user-onboarding";

const validBody = {
  expectedRevision: 0,
  answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null },
};
const reject = (p: Promise<unknown>) => p.then((v) => { throw new Error(`resolved ${JSON.stringify(v)}`); }, (e) => e);

beforeEach(() => vi.resetAllMocks());

describe("submitUserOnboarding SQLSTATE mapping", () => {
  it.each([
    ["42501", 401, "UNAUTHENTICATED"],
    ["40001", 409, "STALE_PROFILE"],
    ["22023", 422, "INVALID_ONBOARDING"],
  ])("maps %s -> %d", async (code, status, appCode) => {
    rpcMock.mockResolvedValue({ data: null, error: { code } });
    const error = await reject(submitUserOnboarding(validBody));
    expect(error).toMatchObject({ status, code: appCode });
  });
  it("falls through an unmapped SQLSTATE to databaseError", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(await reject(submitUserOnboarding(validBody))).toBeInstanceOf(AppError);
  });
  it("returns the new revision on success", async () => {
    rpcMock.mockResolvedValue({ data: 4, error: null });
    expect(await submitUserOnboarding(validBody)).toEqual({ profileRevision: 4, needsOnboarding: false });
  });
  it("rejects a malformed body before touching Supabase", async () => {
    expect(await reject(submitUserOnboarding({ expectedRevision: -1, answers: {} }))).toBeInstanceOf(Object);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `tests/api/user-onboarding.test.ts` (RED)** — mirrors
  `tests/api/onboarding.test.ts`; action mocked.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({ getMyUserOnboarding: vi.fn(), submitUserOnboarding: vi.fn() }));
vi.mock("@/app/actions/user-onboarding", () => mocks);

import { GET, POST } from "@/app/api/onboarding/route";

const post = (body?: unknown, origin = "https://trip.test") =>
  new Request("https://trip.test/api/onboarding", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const validBody = { expectedRevision: 0, answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null } };

beforeEach(() => vi.resetAllMocks());

describe("global onboarding route", () => {
  it("returns the caller's snapshot with a private cache header", async () => {
    mocks.getMyUserOnboarding.mockResolvedValue({ profile: null, profileRevision: 0, dealbreakers: {}, needsOnboarding: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).needsOnboarding).toBe(true);
  });
  it("accepts a valid same-origin submission", async () => {
    mocks.submitUserOnboarding.mockResolvedValue({ profileRevision: 1, needsOnboarding: false });
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    expect(mocks.submitUserOnboarding).toHaveBeenCalledWith(validBody);
  });
  it("blocks a cross-origin submission before calling the action", async () => {
    const res = await POST(post(validBody, "https://evil.test"));
    expect(res.status).toBe(403);
    expect(mocks.submitUserOnboarding).not.toHaveBeenCalled();
  });
  it("maps a stale-profile AppError to 409", async () => {
    mocks.submitUserOnboarding.mockRejectedValue(new AppError(409, "changed", "STALE_PROFILE"));
    expect((await POST(post(validBody))).status).toBe(409);
  });
});
```

- [ ] **Step 3: Run both — expect FAIL** (modules missing).

- [ ] **Step 4: Create `app/actions/user-onboarding.ts`.**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { submitBodySchema, type OnboardingSnapshot } from "@/lib/domain/onboarding";
import { isOnboardingComplete } from "@/lib/onboarding/gate";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
} from "@/lib/domain/constraints";

const KINDS = ["dietary", "religious_access", "mobility"] as const;
const FLAG_SCHEMA = {
  dietary: dietaryFlagSchema,
  religious_access: religiousAccessFlagSchema,
  mobility: mobilityFlagSchema,
} as const;
const BUCKET = { dietary: "dietary", religious_access: "religiousAccess", mobility: "mobility" } as const;

export async function getMyUserOnboarding(): Promise<OnboardingSnapshot> {
  const client = await createClient();
  await verifiedUser(client);

  const [{ data: profileRow, error: profileError }, { data: constraintRows, error: constraintError }] = await Promise.all([
    client.from("user_travel_profiles")
      .select("travel_vibe,serendipity_epsilon,onboarding_completed_at,profile_revision")
      .maybeSingle(),
    client.from("user_travel_constraints")
      .select("kind,flag,confirmed_at")
      .is("retired_at", null).in("kind", [...KINDS]),
  ]);
  if (profileError) databaseError(profileError);
  if (constraintError) databaseError(constraintError);

  const dealbreakers = {
    dietary: { confirmed: [] as string[], pending: [] as string[] },
    religiousAccess: { confirmed: [] as string[], pending: [] as string[] },
    mobility: { confirmed: [] as string[], pending: [] as string[] },
  };
  for (const row of constraintRows ?? []) {
    const kind = row.kind as (typeof KINDS)[number];
    const parsed = FLAG_SCHEMA[kind]?.safeParse(row.flag);
    if (!parsed?.success) continue;
    dealbreakers[BUCKET[kind]][row.confirmed_at ? "confirmed" : "pending"].push(parsed.data);
  }

  const profile = profileRow
    ? {
        travelVibe: profileRow.travel_vibe,
        serendipityEpsilon: Number(profileRow.serendipity_epsilon),
        onboardingCompletedAt: profileRow.onboarding_completed_at,
      }
    : null;

  return {
    profile,
    profileRevision: profileRow ? Number(profileRow.profile_revision) : 0,
    dealbreakers: dealbreakers as OnboardingSnapshot["dealbreakers"],
    needsOnboarding: profile?.onboardingCompletedAt == null,
  };
}

export async function getUserOnboardingComplete(): Promise<boolean> {
  const client = await createClient();
  await verifiedUser(client);
  return isOnboardingComplete(client);
}

function mapUserRpcError(error: { code?: string; message?: string }): AppError {
  if (error.code === "42501") return new AppError(401, "Please sign in to continue.", "UNAUTHENTICATED");
  if (error.code === "40001") {
    return new AppError(409, "Your preferences changed in another session. Reload to see the latest.", "STALE_PROFILE");
  }
  if (error.code === "22023") {
    return new AppError(422, "Some of your answers were invalid. Please review and resubmit.", "INVALID_ONBOARDING");
  }
  try { databaseError(error); } catch (mapped) { return mapped as AppError; }
  return new AppError(503, "Onboarding is temporarily unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export async function submitUserOnboarding(rawBody: unknown) {
  const { expectedRevision, answers } = submitBodySchema.parse(rawBody);
  const client = await createClient();
  await verifiedUser(client);
  const { data, error } = await client.rpc("submit_user_onboarding", {
    p_expected_revision: expectedRevision,
    p_answers: answers,
  });
  if (error) throw mapUserRpcError(error);
  return { profileRevision: Number(data), needsOnboarding: false as const };
}
```

- [ ] **Step 5: Create `app/api/onboarding/route.ts`.**

```ts
import { getMyUserOnboarding, submitUserOnboarding } from "@/app/actions/user-onboarding";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getMyUserOnboarding();
    return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const result = await submitUserOnboarding(await readJson(request));
    return Response.json(result, { status: 200 });
  } catch (error) { return errorResponse(error); }
}
```

- [ ] **Step 6: Run both new tests — expect PASS.** `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `feat(onboarding): global user-onboarding action + /api/onboarding`.

---

## Task 3 — `components/user-onboarding-wizard.tsx`

**Files:** Create `components/user-onboarding-wizard.tsx`,
`tests/components/user-onboarding-wizard.test.tsx`.

Two screens, no modes. Screen 1 = safety vault (dietary / religious-access / mobility chips,
"none" is allowed — Next is always enabled). Screen 2 = one optional 1–5 dial with a **Skip**
checkbox (checked → `surpriseDial: null`). Finish POSTs `{ expectedRevision, answers: {
dealbreakers, surpriseDial } }` to `endpoint` and `router.replace(successHref)`. A 409
`STALE_PROFILE` shows a Reload button that re-GETs `endpoint`, reseeds, and lets the user
resubmit. Confirmed snapshot flags render pressed + disabled (add-only, like the legacy
wizard). Reuse `.onboarding`, `.onboarding-progress`, `.onboarding-nav`, `.flag-grid`,
`.flag-chip`, `.onboarding-dial`, `.error-notice`, `.primary-button`, `.secondary-button`,
`.field-hint` from `app/globals.css`.

- [ ] **Step 1: Write `tests/components/user-onboarding-wizard.test.tsx` (RED).**

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import type { OnboardingSnapshot } from "@/lib/domain/onboarding";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));

const emptySnapshot: OnboardingSnapshot = {
  profile: null, profileRevision: 0,
  dealbreakers: {
    dietary: { confirmed: [], pending: [] },
    religiousAccess: { confirmed: [], pending: [] },
    mobility: { confirmed: [], pending: [] },
  },
  needsOnboarding: true,
};

const fetchMock = vi.fn<typeof fetch>();
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const lastPostBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); replace.mockReset(); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("UserOnboardingWizard", () => {
  it("starts on the safety screen with Next always enabled", () => {
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/" />);
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("submits an empty safety vault and a skipped dial, then redirects", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ profileRevision: 1, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/chats" />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("checkbox", { name: /skip/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chats"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/onboarding");
    expect(lastPostBody()).toEqual({
      expectedRevision: 0,
      answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null },
    });
  });

  it("includes picked safety flags and a set dial", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ profileRevision: 1, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/" endpoint="/api/onboarding" />);
    await user.click(screen.getByRole("button", { name: "Halal" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("checkbox", { name: /skip/i }));       // un-skip
    const dial = screen.getByRole("slider");
    await user.clear?.(dial).catch(() => {});
    dial.focus();
    await user.keyboard("{Home}");                                          // -> 1
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastPostBody().answers).toEqual({
      dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] },
      surpriseDial: 1,
    });
  });

  it("locks an already-confirmed flag", async () => {
    const user = userEvent.setup();
    render(<UserOnboardingWizard successHref="/" initial={{
      ...emptySnapshot,
      dealbreakers: { ...emptySnapshot.dealbreakers, dietary: { confirmed: ["halal"], pending: [] } },
    }} />);
    const chip = screen.getByRole("button", { name: "Halal" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("recovers from a stale 409 by reloading and resubmitting", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(json({ error: "changed", code: "STALE_PROFILE" }, 409))
      .mockResolvedValueOnce(json({ ...emptySnapshot, profileRevision: 4 }))
      .mockResolvedValueOnce(json({ profileRevision: 5, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/chats" />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("button", { name: "Reload" });
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByText("Step 1 of 2")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chats"));
    expect(lastPostBody().expectedRevision).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Create `components/user-onboarding-wizard.tsx`.** Model structure on
  `components/onboarding-wizard.tsx` (progress line, `headingRef` focus, `reseed`,
  `toggleFlag`, `finish`, `reload`) but only two screens and the new answer shape.

```tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIETARY_FLAGS, DIETARY_FLAG_LABELS,
  RELIGIOUS_ACCESS_FLAGS, RELIGIOUS_ACCESS_FLAG_LABELS,
  MOBILITY_FLAGS, MOBILITY_FLAG_LABELS,
} from "@/lib/domain/constraints";
import {
  SURPRISE_DIAL_DEFAULT, epsilonToSurpriseDial, type OnboardingSnapshot,
} from "@/lib/domain/onboarding";

const SURPRISE_LABELS = ["familiar classics", "mostly familiar", "a balanced mix", "mostly new", "open-ended discovery"];

type Draft = {
  dietary: Set<string>;
  religiousAccess: Set<string>;
  mobility: Set<string>;
  dialSkipped: boolean;
  surpriseDial: number;
};

function draftFrom(snapshot: OnboardingSnapshot): Draft {
  const completed = snapshot.profile?.onboardingCompletedAt != null;
  return {
    dietary: new Set(snapshot.dealbreakers.dietary.confirmed),
    religiousAccess: new Set(snapshot.dealbreakers.religiousAccess.confirmed),
    mobility: new Set(snapshot.dealbreakers.mobility.confirmed),
    dialSkipped: !completed,
    surpriseDial: completed ? epsilonToSurpriseDial(snapshot.profile!.serendipityEpsilon) : SURPRISE_DIAL_DEFAULT,
  };
}

export function UserOnboardingWizard({ initial, successHref, endpoint = "/api/onboarding" }: {
  initial: OnboardingSnapshot;
  successHref: string;
  endpoint?: string;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [expectedRevision, setExpectedRevision] = useState(initial.profileRevision);
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { headingRef.current?.focus(); }, [step]);

  function reseed(next: OnboardingSnapshot) {
    setSnapshot(next);
    setDraft(draftFrom(next));
    setExpectedRevision(next.profileRevision);
    setStep(1);
    setError(null);
    setStale(false);
  }

  function toggleFlag(key: "dietary" | "religiousAccess" | "mobility", flag: string) {
    setDraft((current) => {
      const nextSet = new Set(current[key]);
      nextSet.has(flag) ? nextSet.delete(flag) : nextSet.add(flag);
      return { ...current, [key]: nextSet };
    });
  }

  function buildAnswers() {
    return {
      dealbreakers: {
        dietary: [...draft.dietary],
        religiousAccess: [...draft.religiousAccess],
        mobility: [...draft.mobility],
      },
      surpriseDial: draft.dialSkipped ? null : draft.surpriseDial,
    };
  }

  async function finish() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision, answers: buildAnswers() }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) { router.replace(successHref); return; }
      if (data?.code === "STALE_PROFILE") { setStale(true); setError(data.error ?? "Your preferences changed elsewhere."); return; }
      setError(data?.error ?? `Could not save your answers (${response.status}).`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    setPending(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = (await response.json()) as OnboardingSnapshot;
      if (response.ok) reseed(data);
      else setError("Reload failed. Refresh the page and try again.");
    } catch {
      setError("Reload failed. Refresh the page and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="onboarding" aria-labelledby="user-onboarding-heading">
      <p className="onboarding-progress">
        <span className="onboarding-step-count">Step {step} of 2</span>
      </p>
      <h2 id="user-onboarding-heading" ref={headingRef} tabIndex={-1}>
        {step === 1 ? "Your dietary and access needs" : "How adventurous should suggestions be?"}
      </h2>

      {step === 1 && (
        <div className="onboarding-dealbreakers">
          <p className="field-hint">
            Confirm anything you always need respected on a trip. You can pick nothing and continue —
            you will confirm these again for each trip you join.
          </p>
          <ChipGroup title="Dietary" flags={DIETARY_FLAGS} labels={DIETARY_FLAG_LABELS}
            selected={draft.dietary} confirmed={snapshot.dealbreakers.dietary.confirmed}
            onToggle={(flag) => toggleFlag("dietary", flag)} />
          <ChipGroup title="Religious access" flags={RELIGIOUS_ACCESS_FLAGS} labels={RELIGIOUS_ACCESS_FLAG_LABELS}
            selected={draft.religiousAccess} confirmed={snapshot.dealbreakers.religiousAccess.confirmed}
            onToggle={(flag) => toggleFlag("religiousAccess", flag)} />
          <ChipGroup title="Mobility" flags={MOBILITY_FLAGS} labels={MOBILITY_FLAG_LABELS}
            selected={draft.mobility} confirmed={snapshot.dealbreakers.mobility.confirmed}
            onToggle={(flag) => toggleFlag("mobility", flag)} />
        </div>
      )}

      {step === 2 && (
        <div className="onboarding-dial">
          <label className="onboarding-quick">
            <input type="checkbox" checked={draft.dialSkipped}
              onChange={(event) => setDraft({ ...draft, dialSkipped: event.target.checked })} />
            Skip this — use a balanced default
          </label>
          <label htmlFor="surprise-dial">How far from the familiar should suggestions go?</label>
          <input id="surprise-dial" type="range" min={1} max={5} step={1}
            value={draft.surpriseDial} disabled={draft.dialSkipped}
            aria-valuetext={`${draft.surpriseDial} of 5 — ${SURPRISE_LABELS[draft.surpriseDial - 1]}`}
            onChange={(event) => setDraft({ ...draft, surpriseDial: Number(event.target.value) })} />
          <p aria-hidden="true">
            {draft.dialSkipped ? "Balanced default" : `${draft.surpriseDial} of 5 — ${SURPRISE_LABELS[draft.surpriseDial - 1]}`}
          </p>
        </div>
      )}

      {error && (
        <p className="error-notice" role="alert">
          <span>{error}</span>
          {stale && (
            <button type="button" className="secondary-button" disabled={pending} onClick={() => void reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <div className="onboarding-nav">
        <button type="button" className="secondary-button" disabled={pending || step === 1}
          onClick={() => setStep(1)}>
          Back
        </button>
        {step === 1 ? (
          <button type="button" className="primary-button" disabled={pending} onClick={() => setStep(2)}>
            Next
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={pending} onClick={() => void finish()}>
            Finish
          </button>
        )}
      </div>
    </section>
  );
}

function ChipGroup({ title, flags, labels, selected, confirmed, onToggle }: {
  title: string;
  flags: readonly string[];
  labels: Record<string, string>;
  selected: Set<string>;
  confirmed: string[];
  onToggle: (flag: string) => void;
}) {
  return (
    <fieldset className="onboarding-chip-group">
      <legend>{title}</legend>
      <div className="flag-grid" role="group" aria-label={title}>
        {flags.map((flag) => {
          const isConfirmed = confirmed.includes(flag);
          return (
            <button key={flag} type="button" className="flag-chip"
              aria-pressed={isConfirmed || selected.has(flag)}
              disabled={isConfirmed}
              title={isConfirmed ? "Already saved — editing saved requirements is coming with the preferences editor" : undefined}
              onClick={() => onToggle(flag)}>
              {labels[flag]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run — expect PASS.** Adjust the dial-interaction lines in the test if
  `userEvent` slider driving differs (use `fireEvent.change(dial, { target: { value: "1" } })`
  as a fallback). `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(onboarding): two-screen safety-first onboarding wizard`.

---

## Task 4 — `app/onboarding/page.tsx` + `app/preferences/page.tsx`

**Files:** Create both pages. No unit tests (repo precedent: server pages are covered by the
route + build, not unit tests).

- [ ] **Step 1: Create `app/onboarding/page.tsx`.**

```tsx
import { redirect } from "next/navigation";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import { getMyUserOnboarding } from "@/app/actions/user-onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/supabase/redirect";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const snapshot = await getMyUserOnboarding();
  const { next } = await searchParams;
  // Interim default "/"; Slice 3 makes it "/chats".
  const successHref = safeRedirectPath(next ?? null);

  return (
    <main className="app-shell">
      <div className="section-heading">
        <div>
          <h1>Your Travel DNA</h1>
          <p className="field-hint">
            A one-time safety check — the needs you always want respected. About 10 seconds, and you
            can skip anything. We confirm these again for each trip you join.
          </p>
        </div>
      </div>
      <UserOnboardingWizard initial={snapshot} successHref={successHref} />
    </main>
  );
}
```

- [ ] **Step 2: Create `app/preferences/page.tsx`.**

```tsx
import { redirect } from "next/navigation";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import { getMyUserOnboarding } from "@/app/actions/user-onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const snapshot = await getMyUserOnboarding();

  return (
    <main className="app-shell">
      <div className="section-heading">
        <div>
          <h1>Your Travel Preferences</h1>
          <p className="field-hint">
            Update the needs you always want respected, and how adventurous suggestions should be.
            Saved dietary, religious-access, and mobility requirements are add-only here for now.
          </p>
        </div>
      </div>
      <UserOnboardingWizard initial={snapshot} successHref="/preferences" />
    </main>
  );
}
```

- [ ] **Step 3: `npx tsc --noEmit` + `npm run build`** — the three new routes
  (`/onboarding`, `/preferences`, `/api/onboarding`) must compile.
- [ ] **Step 4: Commit** — `feat(onboarding): /onboarding and /preferences pages`.

---

## Task 5 — the middleware gate

**Files:** Modify `middleware.ts`; extend `tests/api/auth.test.ts`.

- [ ] **Step 1: Add gate cases to `tests/api/auth.test.ts`** inside the
  `describe("middleware with Supabase SSR", ...)` block (RED). Route
  `mocks.fetch` for the extra PostgREST call.

```ts
  const profileFetch = (row: unknown) => async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === `${supabaseUrl}/auth/v1/user`) return Response.json(user);
    if (u.includes("/rest/v1/user_travel_profiles")) return Response.json(row);   // object or null
    throw new Error(`Unexpected request: ${u}`);
  };

  it("redirects an authenticated user with no profile row to /onboarding with a next param", async () => {
    mocks.fetch.mockImplementation(profileFetch(null));
    const response = await middleware(request("/trips/abc/workspace"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://trip.test/onboarding?next=%2Ftrips%2Fabc%2Fworkspace");
  });

  it("redirects an authenticated user with a null completion timestamp, and omits next for /", async () => {
    mocks.fetch.mockImplementation(profileFetch({ onboarding_completed_at: null }));
    const response = await middleware(request("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://trip.test/onboarding");
  });

  it("lets a completed user through", async () => {
    mocks.fetch.mockImplementation(profileFetch({ onboarding_completed_at: "2026-09-07T00:00:00Z" }));
    const response = await middleware(request("/trips/abc/workspace"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not gate /onboarding itself or /api/* (no loop, no JSON gate)", async () => {
    mocks.fetch.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url) === `${supabaseUrl}/auth/v1/user`) return Response.json(user);
      throw new Error(`gate must not query the DB for exempt paths: ${String(url)}`);
    });
    expect((await middleware(request("/onboarding"))).status).toBe(200);
    expect((await middleware(request("/api/onboarding"))).status).toBe(200);
  });

  it("does not consult the gate for an unauthenticated request", async () => {
    const response = await middleware(new NextRequest("https://trip.test/trips/abc/workspace"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://trip.test/login");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run tests/api/auth.test.ts`).

- [ ] **Step 3: Edit `middleware.ts`.** Add the import and the gate block.

```ts
import { isGateExempt, isOnboardingComplete } from "@/lib/onboarding/gate";
import { safeRedirectPath } from "@/lib/supabase/redirect";
```

  Then, immediately **after** the `if (failure && !publicRoute) { ... }` block and **before**
  the final `cookies.forEach(({ name, value, options }) => response.cookies.set(...))`:

```ts
  if (!failure && !publicRoute && !isGateExempt(path)) {
    if (!(await isOnboardingComplete(client))) {
      const target = new URL("/onboarding", request.url);
      const next = safeRedirectPath(path + request.nextUrl.search);
      if (next !== "/") target.searchParams.set("next", next);
      response = NextResponse.redirect(target);
    }
  }
```

  The refreshed-cookie loop after this still runs against `response`, so a session refreshed
  on this request is preserved on the redirect. `isSupabaseConfigured()` is already enforced
  at the top, so no extra guard.

- [ ] **Step 4: Run `tests/api/auth.test.ts` — expect PASS.** Then the **full sweep**:
  `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.
- [ ] **Step 5: Commit** — `feat(onboarding): enforce the first-login gate in middleware`.
- [ ] **Step 6: Update the umbrella plan** — tick Slice 2, record deviations (new
  `components/user-onboarding-wizard.tsx` instead of mutating the legacy one; interim
  `successHref` default `/`). Do not touch `docs/implementation-status.md` (Slice 6).

---

## Self-review

1. **Spec coverage:** §2.1 gate + exemptions ✔ (T1, T5); redirect-loop-safe ✔ (exempt
   `/onboarding` + `/api/onboarding`); §2.2 two-screen safety-first, "none"/skip, no
   trip name, `router.replace` ✔ (T3, T4); §5 `GET/POST /api/onboarding` private no-store,
   same-origin, revision-checked ✔ (T2); `/preferences` editor ✔ (T4); §6 private by
   default — `getMyUserOnboarding` is self-only via RLS, returns only the caller's rows ✔.
2. **Placeholder scan:** every code block is literal.
3. **Type/signature consistency:** `OnboardingSnapshot` (Slice 1) used verbatim;
   `submit_user_onboarding` RPC params `p_expected_revision` / `p_answers` match the
   migration; `endpoint` default `/api/onboarding` matches the route path; the wizard POST
   body `{ expectedRevision, answers }` matches `submitBodySchema`.
4. **Compat untouched:** `components/onboarding-wizard.tsx`, `app/actions/onboarding.ts`,
   `/api/trips/[tripId]/onboarding`, `lib/domain/onboarding-legacy.ts` — not modified.
