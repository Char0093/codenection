import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listActiveItineraryItems, reorderItineraryItem, schedulePoiItem, unlockItineraryItem, unschedulePoiItem } from "@/lib/itinerary/repository";

const tripId = "12345678-1234-4123-8123-123456789012";

function itemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "22345678-1234-4123-8123-123456789012", itinerary_day_id: "32345678-1234-4123-8123-123456789012",
    title: "Museum", item_type: "culture", local_date: "2026-10-01", local_start_time: "09:00:00",
    local_end_time: "10:00:00", sort_order: 0, fixed_commitment: false, travel_minutes: 0, poi_id: null, ...overrides,
  };
}

function client(options: { rows?: unknown[]; rpcData?: unknown; rpcError?: unknown; tripRow?: unknown } = {}) {
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: options.rows ?? [itemRow()], error: null }),
          }),
          single: async () => ({ data: table === "trips" ? (options.tripRow ?? { revision: 2 }) : null, error: null }),
        }),
      }),
    }),
    rpc: async () => ({ data: options.rpcError ? null : (options.rpcData ?? itemRow()), error: options.rpcError ?? null }),
  };
  return db as unknown as SupabaseClient;
}

describe("listActiveItineraryItems", () => {
  it("maps rows into the domain shape", async () => {
    const items = await listActiveItineraryItems(client(), tripId);
    expect(items).toEqual([{
      id: itemRow().id, dayId: itemRow().itinerary_day_id, title: "Museum", category: "culture",
      localDate: "2026-10-01", localStartTime: "09:00:00", localEndTime: "10:00:00", sortOrder: 0,
      fixedCommitment: false, travelMinutes: 0, poiId: null,
    }]);
  });
});

describe("reorderItineraryItem", () => {
  it("returns the moved item and the trip's new revision", async () => {
    const result = await reorderItineraryItem(client(), tripId, itemRow().id, 1, "2026-10-01", "13:00");
    expect(result.item.localStartTime).toBe("09:00:00");
    expect(result.revision).toBe(2);
  });

  it("maps a stale-revision rejection to a 409 conflict", async () => {
    await expect(reorderItineraryItem(client({ rpcError: { code: "40001", message: "Trip revision changed" } }), tripId, itemRow().id, 1, "2026-10-01", "13:00"))
      .rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it("maps an overlap rejection to a 422, preserving the specific reason so the card can show it", async () => {
    await expect(reorderItineraryItem(client({ rpcError: { code: "23514", message: "Overlaps another activity that day" } }), tripId, itemRow().id, 1, "2026-10-01", "09:30"))
      .rejects.toMatchObject({ status: 422, message: "Overlaps another activity that day" });
  });

  it("preserves the locked-item reason instead of a generic permission message", async () => {
    await expect(reorderItineraryItem(
      client({ rpcError: { code: "23514", message: "Fixed reservations must be unlocked before they can be moved or resized" } }),
      tripId, itemRow().id, 1, "2026-10-01", "13:00",
    )).rejects.toMatchObject({ status: 422, message: "Fixed reservations must be unlocked before they can be moved or resized" });
  });

  it("passes an optional resize duration through to the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: itemRow(), error: null }));
    const withSpy = { ...client(), rpc } as unknown as SupabaseClient;
    await reorderItineraryItem(withSpy, tripId, itemRow().id, 1, "2026-10-01", "09:00", 90);
    expect(rpc).toHaveBeenCalledWith("reorder_itinerary_item", expect.objectContaining({ new_duration_minutes: 90 }));
  });

  it("omits new_duration_minutes for a pure move", async () => {
    const rpc = vi.fn(async () => ({ data: itemRow(), error: null }));
    const withSpy = { ...client(), rpc } as unknown as SupabaseClient;
    await reorderItineraryItem(withSpy, tripId, itemRow().id, 1, "2026-10-01", "13:00");
    expect(rpc).toHaveBeenCalledWith("reorder_itinerary_item", expect.not.objectContaining({ new_duration_minutes: expect.anything() }));
  });
});

describe("schedulePoiItem / unschedulePoiItem", () => {
  const poiId = "42345678-1234-4123-8123-123456789012";

  it("passes the caller's category mapping through to the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: itemRow({ poi_id: poiId }), error: null }));
    const withSpy = { ...client(), rpc } as unknown as SupabaseClient;
    const result = await schedulePoiItem(withSpy, tripId, poiId, 1, "2026-10-01", "09:00", 90, "culture");
    expect(rpc).toHaveBeenCalledWith("schedule_poi_item", expect.objectContaining({
      target_poi_id: poiId, new_duration_minutes: 90, new_item_type: "culture",
    }));
    expect(result.item.poiId).toBe(poiId);
  });

  it("returns the freed poi id when a block goes back to the pool", async () => {
    const rpc = vi.fn(async () => ({ data: poiId, error: null }));
    const withSpy = { ...client(), rpc } as unknown as SupabaseClient;
    const result = await unschedulePoiItem(withSpy, tripId, itemRow().id, 1);
    expect(result).toEqual({ poiId, revision: 2 });
  });

  it("surfaces the unschedule refusal reason for a Gemini block", async () => {
    await expect(unschedulePoiItem(
      client({ rpcError: { code: "23514", message: "Only a place scheduled from the pool can be returned to it" } }),
      tripId, itemRow().id, 1,
    )).rejects.toMatchObject({ status: 422, message: "Only a place scheduled from the pool can be returned to it" });
  });
});

describe("unlockItineraryItem", () => {
  it("returns the unlocked item and the trip's new revision", async () => {
    const result = await unlockItineraryItem(client({ rpcData: itemRow({ fixed_commitment: false }) }), tripId, itemRow().id, 1);
    expect(result.item.fixedCommitment).toBe(false);
    expect(result.revision).toBe(2);
  });

  it("maps a not-found rejection with its specific reason", async () => {
    await expect(unlockItineraryItem(client({ rpcError: { code: "P0002", message: "Activity not found" } }), tripId, itemRow().id, 1))
      .rejects.toMatchObject({ status: 404, message: "Activity not found" });
  });
});
