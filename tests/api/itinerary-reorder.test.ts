import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";

const mocks = vi.hoisted(() => ({
  reorderItineraryItem: vi.fn(), unlockItineraryItem: vi.fn(),
  schedulePoiItem: vi.fn(), unschedulePoiItem: vi.fn(),
  getScheduledItemContext: vi.fn(), assertPlacementAllowed: vi.fn(),
}));
vi.mock("@/lib/itinerary/repository", () => ({
  reorderItineraryItem: mocks.reorderItineraryItem, unlockItineraryItem: mocks.unlockItineraryItem,
  schedulePoiItem: mocks.schedulePoiItem, unschedulePoiItem: mocks.unschedulePoiItem,
  getScheduledItemContext: mocks.getScheduledItemContext,
}));
vi.mock("@/lib/poi/schedule-validation", () => ({ assertPlacementAllowed: mocks.assertPlacementAllowed }));
vi.mock("@/lib/repositories/server", () => ({ tripRepository: async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/auth", () => ({ verifiedUser: vi.fn().mockResolvedValue({ id: "user-1" }) }));

import { POST as reorder } from "@/app/api/trips/[tripId]/itinerary/reorder/route";
import { POST as unlock } from "@/app/api/trips/[tripId]/itinerary/unlock/route";
import { POST as schedule } from "@/app/api/trips/[tripId]/itinerary/schedule/route";
import { POST as unschedule } from "@/app/api/trips/[tripId]/itinerary/unschedule/route";

const tripId = "12345678-1234-4123-8123-123456789012";
const itemId = "22345678-1234-4123-8123-123456789012";
const context = { params: Promise.resolve({ tripId }) };
const item = { item: { id: itemId, dayId: "d1", title: "Museum", category: "culture", localDate: "2026-10-01", localStartTime: "13:00:00", localEndTime: "14:00:00", sortOrder: 0, fixedCommitment: false, travelMinutes: 0 }, revision: 2 };

function request(url: string, body: unknown) {
  return new Request(`https://trip.test/api/trips/${tripId}/${url}`, {
    method: "POST", headers: { Origin: "https://trip.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getScheduledItemContext.mockResolvedValue({ poiId: null, durationMinutes: 60 });
  mocks.assertPlacementAllowed.mockResolvedValue({ itemType: "culture" });
});

describe("itinerary reorder route", () => {
  it("moves an item without a duration", async () => {
    mocks.reorderItineraryItem.mockResolvedValue(item);
    const response = await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "13:00" }), context);
    expect(response.status).toBe(200);
    expect(mocks.reorderItineraryItem).toHaveBeenCalledWith(expect.anything(), tripId, itemId, 1, "2026-10-01", "13:00", undefined);
  });

  it("passes a resize duration through to the repository", async () => {
    mocks.reorderItineraryItem.mockResolvedValue(item);
    await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "09:00", durationMinutes: 90 }), context);
    expect(mocks.reorderItineraryItem).toHaveBeenCalledWith(expect.anything(), tripId, itemId, 1, "2026-10-01", "09:00", 90);
  });

  it("rejects a duration outside the 15-480 minute domain contract before calling the repository", async () => {
    const response = await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "09:00", durationMinutes: 5 }), context);
    expect(response.status).toBe(422);
    expect(mocks.reorderItineraryItem).not.toHaveBeenCalled();
  });

  it("surfaces the specific rejection reason from a locked-item refusal", async () => {
    mocks.reorderItineraryItem.mockRejectedValue(new AppError(422, "Fixed reservations must be unlocked before they can be moved or resized", "VALIDATION_FAILED"));
    const response = await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "13:00" }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("Fixed reservations must be unlocked before they can be moved or resized");
  });

  it("revalidates a pool-scheduled block against opening hours before moving it", async () => {
    mocks.getScheduledItemContext.mockResolvedValue({ poiId: "32345678-1234-4123-8123-123456789012", durationMinutes: 90 });
    mocks.assertPlacementAllowed.mockRejectedValue(new AppError(422, "The visit does not fit inside the opening hours.", "VALIDATION_FAILED"));
    const response = await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "23:00" }), context);
    expect(response.status).toBe(422);
    expect(mocks.reorderItineraryItem).not.toHaveBeenCalled();
  });

  it("passes a pure move's existing duration into the revalidation", async () => {
    mocks.getScheduledItemContext.mockResolvedValue({ poiId: "32345678-1234-4123-8123-123456789012", durationMinutes: 45 });
    mocks.reorderItineraryItem.mockResolvedValue(item);
    await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "13:00" }), context);
    expect(mocks.assertPlacementAllowed).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ durationMinutes: 45 }));
  });

  it("does not run POI revalidation for a Gemini block, which has no catalog row", async () => {
    mocks.reorderItineraryItem.mockResolvedValue(item);
    await reorder(request("itinerary/reorder", { itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "13:00" }), context);
    expect(mocks.assertPlacementAllowed).not.toHaveBeenCalled();
  });

  it("blocks cross-origin writes", async () => {
    const response = await reorder(new Request(`https://trip.test/api/trips/${tripId}/itinerary/reorder`, {
      method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify({ itemId, expectedRevision: 1, newDate: "2026-10-01", newStartTime: "13:00" }),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.reorderItineraryItem).not.toHaveBeenCalled();
  });
});

describe("itinerary unlock route", () => {
  it("unlocks an item", async () => {
    mocks.unlockItineraryItem.mockResolvedValue({ ...item, item: { ...item.item, fixedCommitment: false } });
    const response = await unlock(request("itinerary/unlock", { itemId, expectedRevision: 1 }), context);
    expect(response.status).toBe(200);
    expect(mocks.unlockItineraryItem).toHaveBeenCalledWith(expect.anything(), tripId, itemId, 1);
  });

  it("blocks cross-origin writes", async () => {
    const response = await unlock(new Request(`https://trip.test/api/trips/${tripId}/itinerary/unlock`, {
      method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify({ itemId, expectedRevision: 1 }),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.unlockItineraryItem).not.toHaveBeenCalled();
  });
});

describe("itinerary schedule route", () => {
  const poiId = "32345678-1234-4123-8123-123456789012";
  const body = { poiId, expectedRevision: 1, localDate: "2026-10-01", startTime: "09:00", durationMinutes: 90 };

  it("schedules a pool place and returns 201", async () => {
    mocks.schedulePoiItem.mockResolvedValue(item);
    const response = await schedule(request("itinerary/schedule", body), context);
    expect(response.status).toBe(201);
    expect(mocks.schedulePoiItem).toHaveBeenCalledWith(expect.anything(), tripId, poiId, 1, "2026-10-01", "09:00", 90, "culture");
  });

  it.each([
    ["a duration under the domain minimum", { ...body, durationMinutes: 10 }],
    ["a duration over the domain maximum", { ...body, durationMinutes: 600 }],
    ["a malformed time", { ...body, startTime: "9am" }],
  ])("rejects %s before touching the repository", async (_label, invalid) => {
    const response = await schedule(request("itinerary/schedule", invalid), context);
    expect(response.status).toBe(422);
    expect(mocks.schedulePoiItem).not.toHaveBeenCalled();
  });

  it("blocks cross-origin writes", async () => {
    const response = await schedule(new Request(`https://trip.test/api/trips/${tripId}/itinerary/schedule`, {
      method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify(body),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.schedulePoiItem).not.toHaveBeenCalled();
  });
});

describe("itinerary unschedule route", () => {
  it("returns the freed place id", async () => {
    mocks.unschedulePoiItem.mockResolvedValue({ poiId: "32345678-1234-4123-8123-123456789012", revision: 3 });
    const response = await unschedule(request("itinerary/unschedule", { itemId, expectedRevision: 1 }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 3 });
  });

  it("surfaces the refusal reason for a block that did not come from the pool", async () => {
    mocks.unschedulePoiItem.mockRejectedValue(new AppError(422, "Only a place scheduled from the pool can be returned to it", "VALIDATION_FAILED"));
    const response = await unschedule(request("itinerary/unschedule", { itemId, expectedRevision: 1 }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/scheduled from the pool/);
  });

  it("blocks cross-origin writes", async () => {
    const response = await unschedule(new Request(`https://trip.test/api/trips/${tripId}/itinerary/unschedule`, {
      method: "POST", headers: { Origin: "https://evil.test" }, body: JSON.stringify({ itemId, expectedRevision: 1 }),
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.unschedulePoiItem).not.toHaveBeenCalled();
  });
});
