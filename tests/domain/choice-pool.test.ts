import { describe, expect, it } from "vitest";
import {
  buildChoicePool,
  candidatesInCategory,
  categorizePoi,
  defaultVisitMinutes,
  isFoodVenue,
  isSamePlace,
  itemTypeForCategory,
  searchCandidates,
  type CuratedPoiRow,
  type ProviderPoiResult,
} from "@/lib/poi/choice-pool";
import type { ConfirmedConstraintFlag } from "@/lib/domain/constraint-gate";

const SELECTED_DATE = "2026-10-01";

function curated(overrides: Partial<CuratedPoiRow> = {}): CuratedPoiRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Seri Nyonya Restaurant",
    latitude: 2.194059, longitude: 102.249154,
    tags: ["food", "peranakan"],
    costTier: "premium",
    halalStatus: "claimed", allergenRisk: [], allergenDataUnknown: true, dressCode: "none",
    shortDescription: "Peranakan restaurant inside a Bandar Hilir hotel.",
    officialUrl: "https://example.invalid/seri-nyonya",
    sourceUrl: "https://example.invalid/source", sourceNote: "Reviewed", verifiedAt: "2026-09-05",
    providerPlaceId: null, businessStatus: null, providerHours: null,
    providerHoursFetchedAt: null, providerHoursExpiresAt: null,
    ...overrides,
  };
}

function providerResult(overrides: Partial<ProviderPoiResult> = {}): ProviderPoiResult {
  return {
    providerPlaceId: "places/abc123",
    name: "Seri Nyonya Restaurant",
    latitude: 2.194059, longitude: 102.249154,
    tags: ["food"],
    providerDescription: "Provider-written blurb.",
    attribution: "Data © Google",
    googleMapsUri: "https://maps.example.invalid/abc123",
    businessStatus: "operational",
    providerHours: { periods: [{ open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 22, minute: 0 } }] },
    fetchedAt: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

const halalConfirmed: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "halal", severity: "severe" }];

describe("categorizePoi", () => {
  it.each([
    [["food", "fine_dining", "rooftop"], "food"],
    [["park", "nature", "family"], "nature"],
    [["museum", "heritage"], "heritage"],
    [["temple"], "heritage"],
    [["family", "aquarium", "indoor"], "entertainment"],
    [["landmark", "architecture", "viewpoint"], "culture"],
    [["something-unmapped"], "local_wildcard"],
    [[], "local_wildcard"],
  ])("maps %j to %s", (tags, expected) => {
    expect(categorizePoi(tags as string[])).toBe(expected);
  });

  it("classifies a mall that also serves food as shopping, deterministically regardless of tag order", () => {
    expect(categorizePoi(["shopping", "mall", "food"])).toBe("shopping");
    expect(categorizePoi(["food", "mall", "shopping"])).toBe("shopping");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(categorizePoi([" FOOD "])).toBe("food");
  });
});

describe("isFoodVenue", () => {
  it("is independent of the display category, so a mall food court still counts as food", () => {
    expect(categorizePoi(["shopping", "mall", "food"])).toBe("shopping");
    expect(isFoodVenue(["shopping", "mall", "food"])).toBe(true);
  });
  it("is false for a venue with no food tag", () => {
    expect(isFoodVenue(["museum", "heritage"])).toBe(false);
  });
});

describe("itemTypeForCategory / defaultVisitMinutes", () => {
  it("collapses the seven pool categories onto the five itinerary item types", () => {
    expect(itemTypeForCategory("food")).toBe("food");
    expect(itemTypeForCategory("nature")).toBe("nature");
    expect(itemTypeForCategory("shopping")).toBe("shopping");
    expect(itemTypeForCategory("heritage")).toBe("culture");
    expect(itemTypeForCategory("entertainment")).toBe("culture");
    expect(itemTypeForCategory("local_wildcard")).toBe("culture");
  });
  it("returns a planning default inside the 15-480 persistence domain", () => {
    for (const category of ["food", "nature", "shopping", "heritage", "culture", "entertainment", "local_wildcard"] as const) {
      const minutes = defaultVisitMinutes(category);
      expect(minutes).toBeGreaterThanOrEqual(15);
      expect(minutes).toBeLessThanOrEqual(480);
    }
  });
});

describe("isSamePlace", () => {
  it("matches on an identical provider place id", () => {
    expect(isSamePlace(curated({ providerPlaceId: "places/abc123", name: "Totally Different" }), providerResult())).toBe(true);
  });
  it("matches the same normalized name at effectively the same location", () => {
    expect(isSamePlace(curated({ name: "Seri Nyonya Restaurant (Hotel Equatorial Melaka)" }), providerResult())).toBe(true);
  });
  it("refuses to merge the same name far apart", () => {
    expect(isSamePlace(curated(), providerResult({ latitude: 3.15, longitude: 101.71 }))).toBe(false);
  });
  it("refuses to merge different names at the same location", () => {
    expect(isSamePlace(curated(), providerResult({ name: "A Completely Different Cafe" }))).toBe(false);
  });
});

describe("buildChoicePool", () => {
  it("builds a categorized curated candidate with its owned evidence intact", () => {
    const [candidate] = buildChoicePool({ curated: [curated()], confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE });
    expect(candidate).toMatchObject({
      poiId: curated().id, category: "food", trust: "curated", servesFood: true,
      shortDescription: "Peranakan restaurant inside a Bandar Hilir hotel.",
      providerDescription: null, travelMinutesFromPrevious: null,
    });
    expect(candidate.openingStatus).toEqual({ kind: "unknown" });
  });

  it("marks a catalog row without provenance as unverified rather than curated", () => {
    const [candidate] = buildChoicePool({ curated: [curated({ sourceUrl: null, verifiedAt: null })], confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE });
    expect(candidate.trust).toBe("unverified");
  });

  it("merges a matching provider result into the curated row without overwriting owned fields", () => {
    const [candidate, ...rest] = buildChoicePool({
      curated: [curated()], provider: [providerResult()],
      confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE,
    });
    expect(rest).toHaveLength(0); // deduplicated, not listed twice
    expect(candidate.trust).toBe("curated");
    expect(candidate.shortDescription).toBe("Peranakan restaurant inside a Bandar Hilir hotel.");
    expect(candidate.providerDescription).toBe("Provider-written blurb.");
    expect(candidate.attribution).toBe("Data © Google");
    expect(candidate.googleMapsUri).toBe("https://maps.example.invalid/abc123");
    expect(candidate.openingStatus).toMatchObject({ kind: "open" });
  });

  it("keeps a non-matching provider result as its own provider-trust candidate with unknown safety data", () => {
    const pool = buildChoicePool({
      curated: [curated()], provider: [providerResult({ providerPlaceId: "places/other", name: "Unrelated Warung", latitude: 3.15, longitude: 101.71 })],
      confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE,
    });
    const providerOnly = pool.find((candidate) => candidate.name === "Unrelated Warung")!;
    expect(providerOnly).toMatchObject({
      poiId: null, trust: "provider", shortDescription: null, halalStatus: "unknown", allergenDataUnknown: true,
    });
    expect(providerOnly.key).toBe("provider:places/other");
  });

  it("fails a provider-only food venue closed under a confirmed halal constraint", () => {
    const pool = buildChoicePool({
      curated: [], provider: [providerResult({ providerPlaceId: "places/unknown-food" })],
      confirmedConstraints: halalConfirmed, travelerCaps: [], selectedDate: SELECTED_DATE,
    });
    expect(pool[0].eligibility.result).toBe("fail");
  });

  it("gates a mall that serves food on its food-ness, not on its shopping display category", () => {
    const pool = buildChoicePool({
      curated: [curated({ name: "Suria KLCC", tags: ["shopping", "mall", "food"], halalStatus: "unknown" })],
      confirmedConstraints: halalConfirmed, travelerCaps: [], selectedDate: SELECTED_DATE,
    });
    expect(pool[0].category).toBe("shopping");
    expect(pool[0].eligibility.result).toBe("fail");
  });

  it("passes a non-food venue untouched by a confirmed dietary constraint", () => {
    const pool = buildChoicePool({
      curated: [curated({ name: "Stadthuys", tags: ["heritage", "museum"] })],
      confirmedConstraints: halalConfirmed, travelerCaps: [], selectedDate: SELECTED_DATE,
    });
    expect(pool[0].category).toBe("heritage");
    expect(pool[0].eligibility.result).toBe("pass");
  });

  it("uses a stored hours snapshot that is still inside its permitted window", () => {
    const pool = buildChoicePool({
      curated: [curated({
        providerHours: { periods: [{ open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 17, minute: 0 } }] },
        providerHoursExpiresAt: "2026-10-02T00:00:00Z",
      })],
      confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(pool[0].openingStatus).toMatchObject({ kind: "open" });
  });

  it("treats an expired snapshot as unknown instead of advertising stale hours as current", () => {
    const pool = buildChoicePool({
      curated: [curated({
        providerHours: { periods: [{ open: { day: 4, hour: 9, minute: 0 }, close: { day: 4, hour: 17, minute: 0 } }] },
        providerHoursExpiresAt: "2026-09-30T00:00:00Z",
      })],
      confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(pool[0].openingStatus).toEqual({ kind: "unknown" });
  });

  it("warns rather than fails for a verified-halal venue with a modest dress code", () => {
    const pool = buildChoicePool({
      curated: [curated({ halalStatus: "verified", allergenDataUnknown: false, dressCode: "modest" })],
      confirmedConstraints: halalConfirmed, travelerCaps: [], selectedDate: SELECTED_DATE,
    });
    expect(pool[0].eligibility.result).toBe("warn");
  });
});

describe("searchCandidates / candidatesInCategory", () => {
  const pool = buildChoicePool({
    curated: [
      curated({ id: "11111111-1111-4111-8111-111111111111", name: "Seri Nyonya Restaurant" }),
      curated({ id: "22222222-2222-4222-8222-222222222222", name: "Stadthuys", tags: ["heritage"], shortDescription: "Dutch colonial administrative building." }),
    ],
    confirmedConstraints: [], travelerCaps: [], selectedDate: SELECTED_DATE,
  });

  it("filters by category and returns everything for 'all'", () => {
    expect(candidatesInCategory(pool, "heritage").map((candidate) => candidate.name)).toEqual(["Stadthuys"]);
    expect(candidatesInCategory(pool, "all")).toHaveLength(2);
  });

  it("searches name and description case-insensitively", () => {
    expect(searchCandidates(pool, "nyonya").map((candidate) => candidate.name)).toEqual(["Seri Nyonya Restaurant"]);
    expect(searchCandidates(pool, "colonial").map((candidate) => candidate.name)).toEqual(["Stadthuys"]);
    expect(searchCandidates(pool, "  ")).toHaveLength(2);
  });
});
