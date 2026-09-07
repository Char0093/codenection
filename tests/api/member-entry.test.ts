import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({ getMyMemberEntryContext: vi.fn(), submitMyMemberEntry: vi.fn() }));
vi.mock("@/app/actions/member-entry", () => mocks);

import { GET, POST } from "@/app/api/trips/[tripId]/member-entry/route";

const id = "12345678-1234-4123-8123-123456789012";
const context = { params: Promise.resolve({ tripId: id }) };
const badContext = { params: Promise.resolve({ tripId: "not-a-uuid" }) };

const body = {
  availability: { coverage: "full", arrivalDate: null, departureDate: null },
  budgetTier: "standard", pace: "balanced", safetyOverrides: [],
};
const post = (payload: unknown, origin = "https://trip.test") =>
  new Request(`https://trip.test/api/trips/${id}/member-entry`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });

beforeEach(() => vi.resetAllMocks());

describe("member-entry route", () => {
  it("GET returns the context, private no-store", async () => {
    mocks.getMyMemberEntryContext.mockResolvedValue({ preview: {}, savedSafety: [], entry: null, alignment: null });
    const res = await GET(new Request("https://trip.test"), context);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getMyMemberEntryContext).toHaveBeenCalledWith(id);
  });

  it("GET rejects a non-uuid tripId with 422", async () => {
    const res = await GET(new Request("https://trip.test"), badContext);
    expect(res.status).toBe(422);
    expect(mocks.getMyMemberEntryContext).not.toHaveBeenCalled();
  });

  it("POST forwards a same-origin body and returns 200 { ok: true }", async () => {
    mocks.submitMyMemberEntry.mockResolvedValue({ ok: true });
    const res = await POST(post(body), context);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.submitMyMemberEntry).toHaveBeenCalledWith(id, body);
  });

  it("POST blocks a cross-origin request before the action", async () => {
    const res = await POST(post(body, "https://evil.test"), context);
    expect(res.status).toBe(403);
    expect(mocks.submitMyMemberEntry).not.toHaveBeenCalled();
  });

  it("POST maps an action AppError(422) to 422", async () => {
    mocks.submitMyMemberEntry.mockRejectedValue(new AppError(422, "bad", "INVALID_MEMBER_ENTRY"));
    expect((await POST(post(body), context)).status).toBe(422);
  });
});
