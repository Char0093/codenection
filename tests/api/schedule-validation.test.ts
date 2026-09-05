import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPlacementAllowed } from "@/lib/poi/schedule-validation";
import type { TripRepository } from "@/lib/repositories/planning-repository";
import type { ConfirmedConstraintFlag } from "@/lib/domain/constraint-gate";

const tripId = "12345678-1234-4123-8123-123456789012";
const poiId = "22345678-1234-4123-8123-123456789012";
const OPEN_9_TO_5 = { periods: [{ open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 17, minute: 0 } }] };
const THURSDAY = "2026-10-01";

/** Returns the poi_catalog row the validator reads, through the same maybeSingle() chain shape. */
function client(row: Record<string, unknown> | null) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  } as unknown as SupabaseClient;
}

function poiRow(overrides: Record<string, unknown> = {}) {
  return {
    id: poiId, name: "Stadthuys", region: "Old Town/Melaka",
    latitude: 2.194, longitude: 102.249, tags: ["heritage", "museum"],
    cost_tier: "budget", halal_status: "unknown", allergen_risk: [], allergen_data_unknown: true,
    dress_code: "none", short_description: null, official_url: null,
    source_url: "https://example.invalid", source_note: null, verified_at: "2026-09-05",
    provider_place_id: null, business_status: null,
    provider_hours: null, provider_hours_fetched_at: null, provider_hours_expires_at: null,
    ...overrides,
  };
}

function repository(overrides: {
  destinationName?: string;
  constraints?: ConfirmedConstraintFlag[];
} = {}): TripRepository {
  return {
    getTrip: async () => ({ id: tripId, destinationName: overrides.destinationName ?? "Melaka" }),
    listConfirmedConstraints: async () => overrides.constraints ?? [],
    listTravelerCaps: async () => [],
  } as unknown as TripRepository;
}

const halalConfirmed: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "halal", severity: "severe" }];

describe("assertPlacementAllowed", () => {
  it("allows a place in the trip's own destination and returns its derived category", async () => {
    const result = await assertPlacementAllowed(client(poiRow()), repository(), {
      tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90,
    });
    // heritage collapses onto the itinerary's five categories as culture.
    expect(result.itemType).toBe("culture");
  });

  it("refuses a place that belongs to a different destination than the trip", async () => {
    await expect(assertPlacementAllowed(
      client(poiRow({ region: "KLCC" })), repository({ destinationName: "Melaka" }),
      { tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90 },
    )).rejects.toMatchObject({ status: 422, message: expect.stringContaining("not in this trip's destination") });
  });

  it("refuses a place when the trip destination has no curated corridor at all", async () => {
    await expect(assertPlacementAllowed(
      client(poiRow()), repository({ destinationName: "Tokyo" }),
      { tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90 },
    )).rejects.toMatchObject({ status: 422 });
  });

  it("enforces the hard-constraint gate server-side, even though the UI already hides the card", async () => {
    await expect(assertPlacementAllowed(
      client(poiRow({ name: "Nancy's Kitchen", tags: ["food"], halal_status: "unknown" })),
      repository({ constraints: halalConfirmed }),
      { tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90 },
    )).rejects.toMatchObject({ status: 422, message: expect.stringContaining("halal_status") });
  });

  it("gates a mall on its food content, so a Shopping label cannot dodge the dietary check", async () => {
    await expect(assertPlacementAllowed(
      client(poiRow({ name: "Suria KLCC", tags: ["shopping", "mall", "food"], halal_status: "unknown" })),
      repository({ constraints: halalConfirmed }),
      { tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90 },
    )).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a visit that does not fit inside the venue's opening hours", async () => {
    const row = poiRow({ provider_hours: OPEN_9_TO_5, provider_hours_expires_at: "2026-10-02T00:00:00Z" });
    const now = new Date("2026-10-01T00:00:00Z");
    await expect(assertPlacementAllowed(client(row), repository(), {
      tripId, poiId, localDate: THURSDAY, startTime: "16:30", durationMinutes: 90,
    }, now)).rejects.toMatchObject({ status: 422, message: expect.stringContaining("opening hours") });

    await expect(assertPlacementAllowed(client(row), repository(), {
      tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90,
    }, now)).resolves.toMatchObject({ itemType: "culture" });
  });

  it("treats an expired hours snapshot as unknown rather than reusing it as evidence", async () => {
    const expired = poiRow({ provider_hours: OPEN_9_TO_5, provider_hours_expires_at: "2026-09-30T00:00:00Z" });
    const now = new Date("2026-10-01T00:00:00Z");
    // 22:00 would be refused against the live 09:00-17:00 snapshot; with the snapshot expired the
    // placement is allowed but must carry the unverified warning instead of a false open claim.
    const result = await assertPlacementAllowed(client(expired), repository(), {
      tripId, poiId, localDate: THURSDAY, startTime: "22:00", durationMinutes: 60,
    }, now);
    expect(result.hoursWarning).toMatch(/unverified/i);
  });

  it("refuses a permanently closed place regardless of hours", async () => {
    await expect(assertPlacementAllowed(
      client(poiRow({ business_status: "closed_permanently" })), repository(),
      { tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90 },
    )).rejects.toMatchObject({ status: 422, message: expect.stringContaining("permanently closed") });
  });

  it("404s for a place that does not exist", async () => {
    await expect(assertPlacementAllowed(client(null), repository(), {
      tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90,
    })).rejects.toMatchObject({ status: 404 });
  });

  it("warns but allows when the venue simply has no hours recorded", async () => {
    const result = await assertPlacementAllowed(client(poiRow()), repository(), {
      tripId, poiId, localDate: THURSDAY, startTime: "09:00", durationMinutes: 90,
    });
    expect(result.hoursWarning).toMatch(/unverified/i);
  });
});
