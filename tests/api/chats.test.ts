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
