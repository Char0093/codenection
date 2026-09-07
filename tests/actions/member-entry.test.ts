import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

type TableResult = { list?: { data: unknown; error: unknown }; single?: { data: unknown; error: unknown } };

const state = vi.hoisted(() => ({
  userId: "u1",
  tables: {} as Record<string, TableResult>,
  rpc: vi.fn(),
}));

function builder(result: TableResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result.single ?? { data: null, error: null });
  chain.then = (onFulfilled: (value: unknown) => unknown) =>
    Promise.resolve(result.list ?? { data: [], error: null }).then(onFulfilled);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }) },
    from: (table: string) => builder(state.tables[table] ?? {}),
    rpc: state.rpc,
  }),
}));

import { getMyMemberEntryContext, submitMyMemberEntry } from "@/app/actions/member-entry";

const tripId = "12345678-1234-4123-8123-123456789012";
const reject = (promise: Promise<unknown>) =>
  promise.then((value) => { throw new Error(`expected rejection, resolved ${JSON.stringify(value)}`); }, (reason) => reason);

const validEntry = {
  availability: { coverage: "full", arrivalDate: null, departureDate: null },
  budgetTier: "standard", pace: "balanced", safetyOverrides: [],
};

beforeEach(() => {
  state.userId = "u1";
  state.rpc.mockReset();
  state.tables = {
    trips: { single: { data: {
      id: tripId, destination_name: "Melaka", start_date: "2026-12-12", end_date: "2026-12-14",
      planned_duration_days: null, proposed_budget_tier: "premium", pace: "active",
    }, error: null } },
    trip_members: { list: { data: [
      { user_id: "u1", display_name: "Me", role: "member" },
      { user_id: "org", display_name: "Ola", role: "owner" },
    ], error: null } },
    trip_member_entries: { single: { data: null, error: null } },
    user_travel_constraints: { list: { data: [{ kind: "dietary", flag: "halal" }], error: null } },
  };
});

describe("getMyMemberEntryContext", () => {
  it("assembles the preview, saved safety, entry and alignment", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null }); // < 2 entries -> null
    const ctx = await getMyMemberEntryContext(tripId);
    expect(ctx.preview).toMatchObject({
      organizerName: "Ola", destinationName: "Melaka", startDate: "2026-12-12", endDate: "2026-12-14",
      memberCount: 2, proposedBudgetTier: "premium", pace: "active",
    });
    expect(ctx.savedSafety).toEqual([{ kind: "dietary", flag: "halal" }]);
    expect(ctx.entry).toBeNull();
    expect(ctx.alignment).toBeNull();
  });

  it("maps an existing entry row and a present alignment summary", async () => {
    state.tables.trip_member_entries = { single: { data: {
      availability_coverage: "partial", arrival_date: "2026-12-13", departure_date: null,
      budget_tier: "budget", pace: "relaxed", safety_overrides: [{ kind: "dietary", flag: "halal" }],
    }, error: null } };
    state.rpc.mockResolvedValue({ data: {
      memberCount: 2, budget: { min: "budget", max: "premium" },
      pace: { relaxed: 1, balanced: 1, active: 0, intense: 0 },
      availability: { full: 1, partial: 1 }, safetyOverrides: [{ kind: "dietary", flag: "halal", count: 1 }],
    }, error: null });
    const ctx = await getMyMemberEntryContext(tripId);
    expect(ctx.entry).toMatchObject({ availability: { coverage: "partial", arrivalDate: "2026-12-13" }, budgetTier: "budget", pace: "relaxed" });
    expect(ctx.alignment?.memberCount).toBe(2);
  });

  it("403s a non-member", async () => {
    state.tables.trip_members = { list: { data: [{ user_id: "org", display_name: "Ola", role: "owner" }], error: null } };
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await reject(getMyMemberEntryContext(tripId))).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("submitMyMemberEntry", () => {
  it("submits a valid entry through the RPC", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await submitMyMemberEntry(tripId, validEntry)).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("submit_member_entry", expect.objectContaining({ p_trip_id: tripId }));
  });

  it("maps RPC 42501 -> 403 and 22023 -> 422", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await reject(submitMyMemberEntry(tripId, validEntry))).toMatchObject({ status: 403 });
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    expect(await reject(submitMyMemberEntry(tripId, validEntry))).toMatchObject({ status: 422 });
  });

  it("rejects a malformed body before the RPC", async () => {
    await reject(submitMyMemberEntry(tripId, { availability: { coverage: "partial", arrivalDate: null, departureDate: null }, budgetTier: "standard", pace: "balanced", safetyOverrides: [] }));
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
