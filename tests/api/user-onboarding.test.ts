import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({ getMyUserOnboarding: vi.fn(), submitUserOnboarding: vi.fn() }));
vi.mock("@/app/actions/user-onboarding", () => mocks);

import { GET, POST } from "@/app/api/onboarding/route";

const post = (body?: unknown, origin = "https://trip.test") =>
  new Request("https://trip.test/api/onboarding", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const validBody = {
  expectedRevision: 0,
  answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null },
};

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
    expect(await res.json()).toEqual({ profileRevision: 1, needsOnboarding: false });
    expect(mocks.submitUserOnboarding).toHaveBeenCalledWith(validBody);
  });

  it("blocks a cross-origin submission before calling the action", async () => {
    const res = await POST(post(validBody, "https://evil.test"));
    expect(res.status).toBe(403);
    expect(mocks.submitUserOnboarding).not.toHaveBeenCalled();
  });

  it("maps a stale-profile AppError to 409", async () => {
    mocks.submitUserOnboarding.mockRejectedValue(new AppError(409, "changed elsewhere", "STALE_PROFILE"));
    const res = await POST(post(validBody));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STALE_PROFILE");
  });

  it("returns 422 for a malformed body", async () => {
    mocks.submitUserOnboarding.mockRejectedValue(new AppError(422, "bad", "INVALID_ONBOARDING"));
    expect((await POST(post({ nope: true }))).status).toBe(422);
  });
});
