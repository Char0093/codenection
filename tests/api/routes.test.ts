import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({ repository: { listTrips: vi.fn(), createTrip: vi.fn(), getTrip: vi.fn(), listProposals: vi.fn(), updateTrip: vi.fn() }, generate: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/repositories/server", () => ({ tripRepository: async () => mocks.repository }));
vi.mock("@/app/actions/proposals", () => ({ generateTripProposal: mocks.generate, decideTripProposal: mocks.decide }));

import { GET as list, POST as create } from "@/app/api/trips/route";
import { GET as load, PATCH as update } from "@/app/api/trips/[tripId]/route";
import { POST as generate } from "@/app/api/trips/[tripId]/proposals/route";
import { POST as decide } from "@/app/api/trips/[tripId]/proposals/[proposalId]/decision/route";

const id = "12345678-1234-4123-8123-123456789012";
const context = { params: Promise.resolve({ tripId: id, proposalId: id }) };
const input = { destinationName: "Penang", startDate: "2026-10-03", endDate: "2026-10-03", budgetTier: "standard", pace: "balanced" };
const request = (body?: unknown) => new Request(`https://trip.test/api/trips/${id}`, { method: "POST", headers: { Origin: "https://trip.test", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(() => vi.resetAllMocks());

describe("trip route handlers", () => {
  it("returns authenticated persisted trips with no shared cache", async () => {
    mocks.repository.listTrips.mockResolvedValue([{ id }]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trips: [{ id }] });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("returns a created trip", async () => {
    mocks.repository.createTrip.mockResolvedValue({ id, ...input });
    const response = await create(request(input));
    expect(response.status).toBe(201);
    expect((await response.json()).trip.id).toBe(id);
  });
  it("returns 401 for unauthenticated storage access", async () => {
    mocks.repository.listTrips.mockRejectedValue(new AppError(401, "Sign in"));
    expect((await list()).status).toBe(401);
  });
  it("rejects invalid dates before storage", async () => {
    expect((await create(request({ ...input, startDate: "2026-02-30" }))).status).toBe(422);
    expect(mocks.repository.createTrip).not.toHaveBeenCalled();
  });
  it("blocks cross-origin writes", async () => {
    const response = await create(new Request("https://trip.test/api/trips", { method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify(input) }));
    expect(response.status).toBe(403);
    expect(mocks.repository.createTrip).not.toHaveBeenCalled();
  });
  it("returns trip and persisted proposals together", async () => {
    mocks.repository.getTrip.mockResolvedValue({ id });
    mocks.repository.listProposals.mockResolvedValue([{ status: "accepted" }]);
    expect(await (await load(request(), context)).json()).toEqual({ trip: { id }, proposals: [{ status: "accepted" }] });
  });
  it("does not query proposals after cross-trip denial", async () => {
    mocks.repository.getTrip.mockRejectedValue(new AppError(404, "Not found"));
    expect((await load(request(), context)).status).toBe(404);
    expect(mocks.repository.listProposals).not.toHaveBeenCalled();
  });
  it("updates validated input", async () => {
    mocks.repository.updateTrip.mockResolvedValue({ id, ...input });
    expect((await update(request(input), context)).status).toBe(200);
    expect(mocks.repository.updateTrip).toHaveBeenCalledWith(id, input);
  });
  it("returns only a pending proposal from generation", async () => {
    mocks.generate.mockResolvedValue({ id, status: "pending" });
    const response = await generate(request(), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ proposal: { id, status: "pending" } });
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("returns retry metadata for distributed throttling", async () => {
    mocks.generate.mockRejectedValue(new AppError(429, "Try later", "RATE_LIMITED"));
    const response = await generate(request(), context);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
  });
  it("accepts explicit decisions and rejects arbitrary status mutation", async () => {
    mocks.decide.mockResolvedValue({ status: "accepted" });
    expect((await decide(request({ decision: "accept" }), context)).status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith(id, id, "accept");
    expect((await decide(request({ status: "accepted" }), context)).status).toBe(422);
  });
  it("keeps database and provider internals out of error responses", async () => {
    mocks.generate.mockRejectedValue(new Error("GEMINI_API_KEY=secret"));
    const response = await generate(request(), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });
});
