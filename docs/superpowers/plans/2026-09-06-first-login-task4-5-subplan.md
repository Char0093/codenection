# Tasks 4 + 5 sub-plan — first-login gate + global Travel DNA

> **SUPERSEDED (2026-09-07)** by
> `docs/superpowers/plans/2026-09-07-safety-pivot-slice-2-gate-onboarding.md` (see the
> umbrella `2026-09-07-travel-dna-safety-pivot.md`). This file predates the safety-first
> pivot: it selects `budget_lean` / `pace` / `social_role` / `mobility_threshold_m` off
> `user_travel_profiles` (dropped in `202609060004`) and assumes a five-screen wizard
> (reduced to a safety-vault screen + one optional dial). Kept for history — **do not
> execute it.**

> Combined because the gate (Task 4) is unsafe to ship without a working global
> `/onboarding` (Task 5): a redirect target that can't accept a submission traps every
> user without a completed global profile. One reviewable unit, one gate flip.
>
> Non-goals for this unit: `/chats` and the "completed user → `/chats`" root redirect
> (Task 6/7); a per-field preferences editor and dealbreaker *retirement* (follow-ups —
> the latter needs its own migration for an `update(retired_at)` grant). The trip-scoped
> `app/actions/onboarding.ts`, `/api/trips/[tripId]/onboarding`, the trip onboarding page,
> and the `travel-dna-nudge` banner stay **fully intact** (compat window, spec §4.5);
> retiring them is Task 7.

---

## Files

**Create**

| File | Responsibility |
| --- | --- |
| `lib/onboarding/gate.ts` | `isGateExempt(path)` + `isOnboardingComplete(client)` — pure/thin, shared by middleware and server components, unit-testable |
| `app/actions/user-onboarding.ts` | `"use server"`: `getMyUserOnboarding()`, `getUserOnboardingComplete()`, `submitUserOnboarding(rawBody)` + internal `mapUserRpcError` |
| `app/api/onboarding/route.ts` | `GET` → snapshot; `POST` → submit. Same wrapper style as `constraints/route.ts`. **Exempt from the gate.** |
| `app/onboarding/page.tsx` | Global onboarding: auth-guard, load the global snapshot, render the wizard with `endpoint="/api/onboarding"` and `successHref = safe(next) ?? "/"` |
| `app/preferences/page.tsx` | "Review & update" — the same wizard, pre-seeded from the global snapshot; submits through the same CAS RPC |
| `tests/lib/onboarding-gate.test.ts` | `isGateExempt` truth table |
| `tests/middleware.test.ts` | gate redirect cases (new / incomplete / complete / signed-out / callback / no-loop / API) |
| `tests/api/user-onboarding.test.ts` | route: GET shape, same-origin POST, 422, 409 mapping (action mocked) |
| `tests/actions/user-onboarding-error-mapping.test.ts` | `mapUserRpcError` via the real `submitUserOnboarding` + a stubbed Supabase client |

**Modify**

| File | Change |
| --- | --- |
| `middleware.ts` | after the existing `verifiedUser` block, for an authenticated user on a non-public, non-exempt path: if `!isOnboardingComplete` → `NextResponse.redirect("/onboarding?next=<safe path>")`. Refreshed cookies still attach to the redirect. |
| `components/onboarding-wizard.tsx` | `tripId?: string` (was required) + new `endpoint?: string`; `finish()`/`reload()` use `endpoint ?? \`/api/trips/${tripId}/onboarding\``. No behavior change for existing callers. |
| `tests/components/onboarding-wizard.test.tsx` | one case: passing `endpoint` POSTs there; default still POSTs the trip path |
| `docs/implementation-status.md` | Task 4/5 status — only after the unit ships |

---

## 1. `lib/onboarding/gate.ts`

```ts
/** Paths the first-login onboarding gate must never redirect, so it cannot loop and never
 *  blocks the flow that completes onboarding. `/login` + `/auth/*` are already handled as
 *  `publicRoute` in middleware; this covers the rest. */
export function isGateExempt(path: string): boolean {
  return path.startsWith("/api/")
    || path === "/onboarding"
    || path.startsWith("/onboarding/");
}

/** True when the caller has a completed global Travel DNA profile. Self-only RLS makes this
 *  a single-row PK lookup. A missing row or null completion timestamp means "not done". */
export async function isOnboardingComplete(
  client: { from: (t: string) => any },
): Promise<boolean> {
  const { data } = await client
    .from("user_travel_profiles")
    .select("onboarding_completed_at")
    .maybeSingle();
  return data?.onboarding_completed_at != null;
}
```
(The `client` type is loose on purpose — middleware passes its `@supabase/ssr` server client, a server component passes `createClient()`'s. RLS scopes the read to `auth.uid()`, so no `.eq("user_id", …)` is needed; `.maybeSingle()` is safe because `user_id` is the PK.)

## 2. `app/actions/user-onboarding.ts`

Mirrors `app/actions/onboarding.ts` minus the trip. Reuses `submitBodySchema` / `OnboardingSnapshot` from `lib/domain/onboarding.ts` verbatim.

- **`getMyUserOnboarding(): Promise<OnboardingSnapshot>`** — `verifiedUser`, then in parallel:
  - `user_travel_profiles` (`travel_vibe, budget_lean, pace, social_role, serendipity_epsilon, mobility_threshold_m, onboarding_completed_at, profile_revision`), `.maybeSingle()`.
  - `user_travel_constraints` (`kind, flag`) `where retired_at is null` — `.in("kind", ["dietary","religious_access","mobility"])`.
  Assemble the identical `OnboardingSnapshot` shape; `dealbreakers.*.confirmed` from the rows, `pending` always `[]` (nothing writes unconfirmed global rows this slice). `profileRevision = row ? Number(profile_revision) : 0`.
- **`getUserOnboardingComplete(): Promise<boolean>`** — `verifiedUser`, then `isOnboardingComplete(client)`. Used by the page and available to any server component.
- **`submitUserOnboarding(rawBody)`** — `submitBodySchema.parse` → `verifiedUser` → `client.rpc("submit_user_onboarding", { p_expected_revision, p_answers })` → on error `throw mapUserRpcError(error)` → return `{ profileRevision: Number(data), needsOnboarding: false as const }`.
- **`mapUserRpcError(error)`** (non-exported): `42501` → `AppError(401, "Please sign in to continue.", "UNAUTHENTICATED")`; `40001` → `AppError(409, "…changed in another session…", "STALE_PROFILE")`; `22023` → `AppError(422, "Some of your answers were invalid…", "INVALID_ONBOARDING")`; else fall through to `databaseError` (catch its throw, return the `AppError`). No `P0001` branch — `submit_user_onboarding` has no pending-conflict path.

## 3. `app/api/onboarding/route.ts`

```ts
export const dynamic = "force-dynamic";
// GET  -> getMyUserOnboarding(); Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } })
// POST -> requireSameOrigin(request); submitUserOnboarding(await readJson(request)); Response.json(result, { status: 200 })
// both wrapped in try/catch -> errorResponse(error)
```
No path params. `/api/onboarding` is covered by `isGateExempt` (`/api/` prefix).

## 4. `app/onboarding/page.tsx`

Server component. `dynamic = "force-dynamic"`.
- `isSupabaseConfigured()` false → `redirect("/login")`.
- `createClient()`; `auth.getUser()`; no user → `redirect("/login")`.
- `snapshot = await getMyUserOnboarding()`.
- `next` from `searchParams`; `safe = safeRedirectPath(next ?? null)`; `successHref = safe !== "/" ? safe : "/"`. (Interim `/`; Task 6 makes the default `/chats`.)
- Render:
  ```tsx
  <main className="app-shell">
    <div className="section-heading"><div>
      <h1>Your Travel DNA</h1>
      <p className="field-hint">A one-time setup — how you generally like to travel. We use it to tune suggestions inside every trip you join.</p>
    </div></div>
    <OnboardingWizard endpoint="/api/onboarding" initial={snapshot} successHref={successHref} />
  </main>
  ```
  No `tripId`, no trip name (spec §2.2).

## 5. `app/preferences/page.tsx`

Same shape as `app/onboarding/page.tsx` but:
- heading "Your Travel Preferences" + "Update any answer; changes apply to future suggestions."
- `successHref = "/preferences"` (stay after saving) — or `safe(next) ?? "/"`.
- Same `<OnboardingWizard endpoint="/api/onboarding" initial={snapshot} …>`. The wizard pre-fills every field from `snapshot`; submitting runs `submit_user_onboarding` with the current `profile_revision` (CAS). Soft fields (vibe/pace/budget/role/dial) update; dealbreakers are **additive** (Task 2's RPC is add-only). Per-field editing and dealbreaker *removal/retirement* are follow-ups (removal needs a migration granting `update(retired_at)` + policy on `user_travel_constraints`).

A completed user reaching `/preferences` passes the gate (gate only redirects the *incomplete*). An incomplete user reaching `/preferences` is redirected to `/onboarding` by the gate — correct.

## 6. `components/onboarding-wizard.tsx`

- Props: `{ tripId?: string; endpoint?: string; initial: OnboardingSnapshot; successHref: string }`.
- `const submitUrl = endpoint ?? \`/api/trips/${encodeURIComponent(tripId!)}/onboarding\`;` (computed once). Used by `finish()` (POST) and `reload()` (GET).
- Runtime guard: if neither `endpoint` nor `tripId` is set, throw in render (developer error). Existing callers (`app/trips/[tripId]/onboarding/page.tsx`, `trip-setup-dashboard.tsx`, `workspace-client.tsx` via the nudge) pass `tripId` and no `endpoint` → identical behavior.
- No copy changes — `STEP_TITLES` are already general-traveler ("What kind of traveler are you?" …).

## 7. `middleware.ts`

Insert after the `failure` handling, before the final `cookies.forEach(({name,value,options}) => response.cookies.set(...))`:

```ts
if (!failure && !publicRoute && !isGateExempt(path) && isSupabaseConfigured()) {
  const complete = await isOnboardingComplete(client);
  if (!complete) {
    const target = new URL("/onboarding", request.url);
    const next = safeRedirectPath(path + request.nextUrl.search);
    if (next !== "/") target.searchParams.set("next", next);
    response = NextResponse.redirect(target);
  }
}
```
- One extra Supabase round-trip per authenticated **page** request (skipped for `/api/*`, exempt paths, and unauthenticated requests that are already being redirected to `/login`).
- The refreshed-cookie loop after this still runs against `response`, so a session refreshed this request is preserved on the redirect.
- `isSupabaseConfigured()` is already checked at the top; the extra guard is defensive.
- **Not** doing the "completed user on `/` → `/chats`" redirect — `/chats` is Task 6.

## 8. Tests

- **`tests/lib/onboarding-gate.test.ts`** — `isGateExempt`: `true` for `/api/x`, `/onboarding`, `/onboarding/anything`; `false` for `/`, `/preferences`, `/chats`, `/trips/abc/workspace`, `/login` (login is handled elsewhere, but assert the fn's own contract).
- **`tests/middleware.test.ts`** — mock `@/lib/supabase/auth`'s `verifiedUser` and a fake `createServerClient` whose `.from("user_travel_profiles").select().maybeSingle()` returns a configurable row. Cases:
  - authenticated + no profile row → 307 redirect to `/onboarding?next=%2Ftrips%2Fabc%2Fworkspace` for a request to `/trips/abc/workspace`.
  - authenticated + `onboarding_completed_at` null → same.
  - authenticated + completed → `NextResponse.next` (status 200-ish, no `location`).
  - unauthenticated (`verifiedUser` throws `AppError(401)`) on a page → existing `/login` redirect, gate not consulted.
  - path `/auth/callback` → passes (publicRoute), gate not consulted.
  - path `/onboarding` while incomplete → **no redirect** (exempt; no loop).
  - path `/api/onboarding` while incomplete → no redirect (JSON path; `/api/` exempt).
  - request to `/` while incomplete → redirect to `/onboarding` **without** a `next` param.
- **`tests/api/user-onboarding.test.ts`** — mock `@/app/actions/user-onboarding`; GET returns the snapshot + `no-store`; a valid same-origin POST → 200 and `submitUserOnboarding` called with the body; cross-origin POST → 403, action not called; a `STALE_PROFILE` `AppError` → 409; malformed body path → 422.
- **`tests/actions/user-onboarding-error-mapping.test.ts`** — no action mock; `vi.mock("@/lib/supabase/server")` so `createClient()` returns `{ auth: { getUser: → user }, rpc: rpcMock }`. For each of `{code:"42501"}` → 401/UNAUTHENTICATED, `{code:"40001"}` → 409/STALE_PROFILE, `{code:"22023"}` → 422/INVALID_ONBOARDING, `{code:"23505"}` (unmapped) → databaseError fall-through, and `{data: 4, error: null}` → `{ profileRevision: 4, needsOnboarding: false }`.
- **`tests/components/onboarding-wizard.test.tsx`** — add: `<OnboardingWizard endpoint="/api/onboarding" …>` makes `finish()` POST to `/api/onboarding`; the existing no-`endpoint` cases (POST `/api/trips/t1/onboarding`) are untouched.
- Pages (`app/onboarding/page.tsx`, `app/preferences/page.tsx`) have no unit test — matches the repo's precedent for server pages.
- Regression: full `npm test`, `npm run build` (the new `/onboarding`, `/preferences`, `/api/onboarding` routes must compile).

## 9. Decisions to flag

1. **Middleware, not a `(app)` route group.** The middleware already runs per request and holds a Supabase client; a route group would mean relocating every page. Cost is one PK lookup per authenticated page request.
2. **This unit's gate only does incomplete → `/onboarding`.** The "completed user on `/` → `/chats`" redirect and `/chats` itself are Task 6/7. `successHref` interim default is `/` (the dashboard), not `/chats`.
3. **`/preferences` is the wizard in a "review & update" framing**, not a per-field editor. Dealbreaker *retirement* is deferred (needs a `user_travel_constraints` `update(retired_at)` grant + policy migration). Soft-field edits + additive dealbreakers work today via the CAS RPC.
4. **New `app/actions/user-onboarding.ts` + `app/api/onboarding/route.ts`** rather than extending the trip-scoped files, which stay untouched for the compat window.
5. **`next` deep-link authorization** is enforced by the *target route's* own guard (e.g. `getTrip` → `notFound()`), not the gate. The gate only guarantees `next` is a safe same-origin path via `safeRedirectPath`, so there is no open redirect; an unauthorized `next` simply 404s at the destination.
6. **Wizard prop change is additive** (`tripId` optional, `endpoint` optional-with-trip-default) — zero change for the three existing call sites and their tests.

## 10. Commits

Two commits (both gated on lint + typecheck + `npm test` + `npm run build`):
1. `feat(onboarding): global Travel DNA action, /api/onboarding, wizard endpoint prop` — items 1–3, 6 + their tests.
2. `feat(onboarding): first-login gate + /onboarding + /preferences` — items 4, 5, 7 + middleware/gate tests + status doc.
