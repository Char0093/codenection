import { createServerClient } from "@supabase/ssr";
import { describe, expect, it, vi } from "vitest";
import { SupabaseTripRepository } from "@/lib/repositories/supabase-trip-repository";
import { generateProposal } from "@/lib/services/trip-proposals";
import { errorResponse } from "@/lib/http/errors";
import { anonKey, cookieName, encodedCookie, session, supabaseUrl, user } from "../api/auth-fixtures";

const id = "12345678-1234-4123-8123-123456789012";
const input = { destinationName: "Penang", startDate: "2026-10-01", endDate: "2026-10-03", budgetTier: "standard", pace: "balanced", notes: "Museums" } as const;
const original = { id, owner_user_id: user.id, destination_name: "Penang", start_date: input.startDate, end_date: input.endDate, budget_tier: "standard", pace: "balanced", notes: null, revision: 1, active_proposal_id: null };
const legacy = { ...original, end_date: "2026-10-30", destination_name: "P".repeat(121), notes: "N".repeat(1001) };

function repository(initialRows: Record<string, unknown>[]) {
  const rows = structuredClone(initialRows);
  const authSession = session();
  const writes: unknown[] = [];
  const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    const parsed = new URL(request.url);
    if (parsed.pathname === "/auth/v1/user") return Response.json(user);
    expect(request.headers.get("apikey")).toBe(anonKey);
    expect(request.headers.get("authorization")).toBe(`Bearer ${authSession.access_token}`);
    if (parsed.pathname === "/rest/v1/trip_members") {
      expect(parsed.searchParams.get("user_id")).toBe(`eq.${user.id}`);
      expect(rows.some((row) => parsed.searchParams.get("trip_id") === `eq.${row.id}`)).toBe(true);
      return Response.json([{ role: "owner" }]);
    }
    expect(parsed.pathname).toBe("/rest/v1/trips");
    const filter = parsed.searchParams.get("id");
    const matches = rows.filter((row) => !filter || filter === `eq.${row.id}`);
    if (request.method === "PATCH") {
      expect(filter).toBe(`eq.${id}`);
      const value = await request.json();
      writes.push(value);
      matches.forEach((row) => Object.assign(row, value));
      return Response.json(matches[0]);
    }
    if (request.method !== "GET") throw new Error("Unexpected storage mutation");
    return Response.json(matches);
  });
  const client = createServerClient(supabaseUrl, anonKey, {
    global: { fetch: transport },
    cookies: { getAll: () => [{ name: cookieName, value: encodedCookie(authSession) }], setAll: () => {} },
  });
  return { repo: new SupabaseTripRepository(client), rows, writes, transport };
}

describe("persisted trip compatibility", () => {
  it("loads legacy duration and text lengths without poisoning a mixed list", async () => {
    const { repo } = repository([legacy, { ...original, id: "22345678-1234-4123-8123-123456789012" }]);
    const trips = await repo.listTrips();
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({ endDate: legacy.end_date, destinationName: legacy.destination_name, notes: legacy.notes });
    expect(await repo.getTrip(id)).toMatchObject({ endDate: legacy.end_date });
  });

  it("lets the owner repair a legacy row and reloads the saved values", async () => {
    const { repo, writes } = repository([legacy]);
    expect(await repo.updateTrip(id, input)).toMatchObject(input);
    expect(await repo.getTrip(id)).toMatchObject(input);
    expect(writes).toEqual([{ destination_name: "Penang", start_date: input.startDate, end_date: input.endDate, budget_tier: "standard", pace: "balanced", notes: "Museums" }]);
  });

  it.each([
    { endDate: "2026-10-30" }, { destinationName: "P".repeat(121) }, { notes: "N".repeat(1001) },
  ])("keeps create, save and generation strict for %j", async (invalid) => {
    const { repo, writes } = repository([{ ...original,
      end_date: invalid.endDate ?? original.end_date,
      destination_name: invalid.destinationName ?? original.destination_name,
      notes: invalid.notes ?? original.notes,
    }]);
    await expect(repo.createTrip({ ...input, ...invalid })).rejects.toMatchObject({ name: "ZodError" });
    await expect(repo.updateTrip(id, { ...input, ...invalid })).rejects.toMatchObject({ name: "ZodError" });
    const planner = vi.fn();
    const reserve = vi.spyOn(repo, "reserveGeneration");
    await expect(generateProposal(id, repo, planner)).rejects.toMatchObject({ name: "ZodError" });
    expect(planner).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it.each([
    { start_date: "2026-02-30" }, { end_date: "2025-01-01" }, { budget_tier: "secret-corrupt-value" },
    { pace: "unsupported" }, { destination_name: null }, { revision: null },
  ])("reports a generic storage error for a corrupt row %j", async (corruption) => {
    const { repo } = repository([{ ...original, ...corruption }]);
    for (const operation of [() => repo.getTrip(id), () => repo.listTrips()]) {
      const error = await operation().catch((failure: unknown) => failure);
      expect(error).toMatchObject({ status: 503, code: "STORAGE_UNAVAILABLE" });
      const response = errorResponse(error);
      expect(await response.json()).toEqual({ error: "Trip storage is unavailable. Please try again.", code: "STORAGE_UNAVAILABLE" });
    }
  });
});
