import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listActiveItineraryItems, reorderItineraryItem } from "@/lib/itinerary/repository";

const tripId = "12345678-1234-4123-8123-123456789012";

function itemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "22345678-1234-4123-8123-123456789012", itinerary_day_id: "32345678-1234-4123-8123-123456789012",
    title: "Museum", item_type: "culture", local_date: "2026-10-01", local_start_time: "09:00:00",
    local_end_time: "10:00:00", sort_order: 0, ...overrides,
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

  it("maps an overlap rejection to a 422 with a readable reason", async () => {
    await expect(reorderItineraryItem(client({ rpcError: { code: "23514", message: "Overlaps another activity that day" } }), tripId, itemRow().id, 1, "2026-10-01", "09:30"))
      .rejects.toMatchObject({ status: 422 });
  });
});
