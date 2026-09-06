import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({ getMyOnboarding: vi.fn(), submitOnboarding: vi.fn() }));
vi.mock("@/app/actions/onboarding", () => ({
  getMyOnboarding: mocks.getMyOnboarding,
  submitOnboarding: mocks.submitOnboarding,
}));

import { GET, POST } from "@/app/api/trips/[tripId]/onboarding/route";

const id = "12345678-1234-4123-8123-123456789012";
const context = { params: Promise.resolve({ tripId: id }) };
const post = (body?: unknown, origin = "https://trip.test") =>
  new Request(`https://trip.test/api/trips/${id}/onboarding`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const validBody = {
  expectedRevision: 0,
  answers: { mode: "quick", dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, walkingCapM: null, budgetLean: "standard" },
};

beforeEach(() => vi.resetAllMocks());

describe("onboarding route", () => {
  it("returns the caller's snapshot with a private cache header", async () => {
    mocks.getMyOnboarding.mockResolvedValue({ profile: null, profileRevision: 0, dealbreakers: {}, needsOnboarding: true });
    const response = await GET(new Request("https://trip.test"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).needsOnboarding).toBe(true);
  });

  it("accepts a valid same-origin submission", async () => {
    mocks.submitOnboarding.mockResolvedValue({ profileRevision: 1, needsOnboarding: false });
    const response = await POST(post(validBody), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profileRevision: 1, needsOnboarding: false });
    expect(mocks.submitOnboarding).toHaveBeenCalledWith(id, validBody);
  });

  it("blocks a cross-origin submission before calling the action", async () => {
    const response = await POST(post(validBody, "https://evil.test"), context);
    expect(response.status).toBe(403);
    expect(mocks.submitOnboarding).not.toHaveBeenCalled();
  });

  it("maps a stale-profile AppError to 409", async () => {
    mocks.submitOnboarding.mockRejectedValue(new AppError(409, "changed elsewhere", "STALE_PROFILE"));
    const response = await POST(post(validBody), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("STALE_PROFILE");
  });

  it("returns 422 for a malformed body", async () => {
    mocks.submitOnboarding.mockRejectedValue(new AppError(422, "bad", "INVALID_ONBOARDING"));
    const response = await POST(post({ nope: true }), context);
    expect(response.status).toBe(422);
  });
});
