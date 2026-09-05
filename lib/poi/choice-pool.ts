import {
  evaluateConstraintGate,
  type ActivityCategory,
  type ConfirmedConstraintFlag,
  type DressCode,
  type GateReason,
  type HalalStatus,
  type TravelerConstraintProfile,
} from "@/lib/domain/constraint-gate";
import type { BusinessStatus, OpeningStatus, ProviderOpeningHours } from "@/lib/poi/opening-hours";
import { isSnapshotUsable, openingStatusForDate } from "@/lib/poi/opening-hours";

/**
 * Implementation_Plan.md Task 3.4: the typed candidate pool the day builder drags from. Pure -- no
 * I/O. The repository supplies curated rows and (when a provider adapter is configured) transient
 * provider results; this module categorizes, resolves duplicates, states trust explicitly, and asks
 * the Phase 1 gate whether each candidate may be dragged at all.
 *
 * Task 5.1 is specified to rank this same typed pool later, so ranking must not need a second
 * candidate model -- everything a ranker would need is on `PoolCandidate`.
 */

export const POOL_CATEGORIES = ["food", "nature", "shopping", "heritage", "culture", "entertainment", "local_wildcard"] as const;
export type PoolCategory = (typeof POOL_CATEGORIES)[number];

export const POOL_CATEGORY_LABELS: Record<PoolCategory, string> = {
  food: "Food",
  nature: "Nature",
  shopping: "Shopping",
  heritage: "Heritage",
  culture: "Culture",
  entertainment: "Entertainment",
  local_wildcard: "Local / Wildcard",
};

/**
 * Deterministic canonical mapping, checked in this order so one venue always lands in one category
 * regardless of tag ordering. Nothing here asks Gemini to classify at render time, which the plan
 * forbids. Order matters for mixed-tag venues: a mall tagged `shopping, mall, food` is a shopping
 * destination, while a restaurant tagged `food, fine_dining` is food.
 */
const CATEGORY_TAGS: readonly (readonly [PoolCategory, readonly string[]])[] = [
  ["heritage", ["heritage", "historic", "history", "unesco", "museum", "temple", "mosque", "church", "fort", "palace", "ruins", "monument"]],
  ["nature", ["nature", "park", "garden", "beach", "river", "forest", "wildlife", "hill", "island"]],
  ["shopping", ["shopping", "mall", "market", "boutique", "bazaar", "souvenir"]],
  ["entertainment", ["entertainment", "aquarium", "theme_park", "nightlife", "show", "cinema", "family", "observation"]],
  ["food", ["food", "restaurant", "cafe", "street_food", "dining", "fine_dining", "dessert", "bakery"]],
  ["culture", ["culture", "landmark", "architecture", "art", "gallery", "viewpoint", "theatre"]],
];

const FOOD_TAGS = new Set(["food", "restaurant", "cafe", "street_food", "dining", "fine_dining", "dessert", "bakery"]);

export function categorizePoi(tags: readonly string[]): PoolCategory {
  const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()));
  for (const [category, categoryTags] of CATEGORY_TAGS) {
    if (categoryTags.some((tag) => normalized.has(tag))) return category;
  }
  return "local_wildcard";
}

/**
 * Whether the venue serves food at all, which is deliberately *not* the same question as its
 * display category. A mall displays under Shopping but still serves food, so the hard-constraint
 * gate must evaluate it as a food item -- categorizing for display must never quietly narrow what
 * the dietary/halal gate looks at.
 */
export function isFoodVenue(tags: readonly string[]): boolean {
  return tags.some((tag) => FOOD_TAGS.has(tag.trim().toLowerCase()));
}

/** Pool categories are a richer display vocabulary than the five itinerary item types the rest of
 * the system already understands, so scheduling collapses them back down. */
export function itemTypeForCategory(category: PoolCategory): ActivityCategory {
  if (category === "food") return "food";
  if (category === "nature") return "nature";
  if (category === "shopping") return "shopping";
  return "culture";
}

/**
 * A planning default for how long to block out, not a claim about the venue. It is the starting
 * height of the block and is immediately resizable; nothing downstream treats it as evidence.
 */
export function defaultVisitMinutes(category: PoolCategory): number {
  if (category === "food") return 90;
  if (category === "nature" || category === "entertainment") return 120;
  return 90;
}

/** `curated` rows carry WanderSync-owned, independently sourced safety evidence. `provider` rows are
 * live third-party content shown with attribution and never relabelled as owned. `unverified` is a
 * catalog row missing its provenance, which must not pass as curated. */
export type TrustLevel = "curated" | "provider" | "unverified";

export type CuratedPoiRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  tags: readonly string[];
  costTier: string;
  halalStatus: HalalStatus;
  allergenRisk: readonly string[];
  allergenDataUnknown: boolean;
  dressCode: DressCode;
  shortDescription: string | null;
  officialUrl: string | null;
  sourceUrl: string | null;
  sourceNote: string | null;
  verifiedAt: string | null;
  providerPlaceId: string | null;
  businessStatus: BusinessStatus | null;
  providerHours: ProviderOpeningHours | null;
  providerHoursFetchedAt: string | null;
  /** Past this instant the snapshot is treated as absent, never quietly reused. */
  providerHoursExpiresAt: string | null;
};

/** A transient provider result. Never persisted into the owned catalog columns. */
export type ProviderPoiResult = {
  providerPlaceId: string;
  name: string;
  latitude: number;
  longitude: number;
  tags: readonly string[];
  /** Provider prose. Rendered only with attribution, never as an owned description. */
  providerDescription: string | null;
  attribution: string;
  googleMapsUri: string | null;
  businessStatus: BusinessStatus | null;
  providerHours: ProviderOpeningHours | null;
  fetchedAt: string;
};

export type PoolCandidate = {
  /** Catalog id for curated rows, `provider:<placeId>` for provider-only rows. */
  key: string;
  poiId: string | null;
  providerPlaceId: string | null;
  name: string;
  latitude: number;
  longitude: number;
  category: PoolCategory;
  trust: TrustLevel;
  /** Owned prose when present. `providerDescription` is kept separate so the UI cannot conflate them. */
  shortDescription: string | null;
  providerDescription: string | null;
  attribution: string | null;
  officialUrl: string | null;
  googleMapsUri: string | null;
  sourceUrl: string | null;
  sourceNote: string | null;
  verifiedAt: string | null;
  costTier: string;
  halalStatus: HalalStatus;
  allergenRisk: readonly string[];
  allergenDataUnknown: boolean;
  dressCode: DressCode;
  servesFood: boolean;
  defaultDurationMinutes: number;
  openingStatus: OpeningStatus;
  /** `fail` candidates are not draggable and are hidden behind an Unavailable explanation. */
  eligibility: { result: "pass" | "warn" | "fail"; reasons: readonly GateReason[] };
  /** Phase 4 routing supplies this later; null renders as "travel time unavailable", never a guess. */
  travelMinutesFromPrevious: number | null;
};

function normalizedName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Rough metre distance. Good to well inside the tens-of-metres precision this resolver needs. */
function approximateMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const latMetres = (aLat - bLat) * 111_320;
  const lngMetres = (aLng - bLng) * 111_320 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(latMetres, lngMetres);
}

const SAME_PLACE_METRES = 150;

/** Conservative: identical provider Place ID, or the same normalized name within 150 m. Anything
 * looser risks merging two genuinely different venues and, with them, their safety data. */
export function isSamePlace(curated: CuratedPoiRow, provider: ProviderPoiResult): boolean {
  if (curated.providerPlaceId && curated.providerPlaceId === provider.providerPlaceId) return true;
  if (normalizedName(curated.name) !== normalizedName(provider.name)) return false;
  return approximateMetres(curated.latitude, curated.longitude, provider.latitude, provider.longitude) <= SAME_PLACE_METRES;
}

function trustFor(row: CuratedPoiRow): TrustLevel {
  return row.sourceUrl && row.verifiedAt ? "curated" : "unverified";
}

export type BuildPoolInput = {
  curated: readonly CuratedPoiRow[];
  provider?: readonly ProviderPoiResult[];
  confirmedConstraints: readonly ConfirmedConstraintFlag[];
  travelerCaps: readonly TravelerConstraintProfile[];
  /** Destination-local date the pool is being built for; drives the opening-hours status shown. */
  selectedDate: string;
  /** Evaluated against each snapshot's expiry so the pool never advertises stale hours as current.
   * Injected rather than read from the clock, keeping this module pure and testable. */
  now?: Date;
};

/**
 * Merges curated and provider candidates into one typed, categorized, gate-evaluated pool. A
 * curated row always wins the merge -- provider content only fills in fields the catalog does not
 * own (attribution, map link, live hours) -- so provider data can never overwrite owned safety
 * evidence.
 */
export function buildChoicePool(input: BuildPoolInput): PoolCandidate[] {
  const provider = input.provider ?? [];
  const consumedProviderIds = new Set<string>();
  const candidates: PoolCandidate[] = [];

  for (const row of input.curated) {
    const match = provider.find((result) => isSamePlace(row, result));
    if (match) consumedProviderIds.add(match.providerPlaceId);
    const category = categorizePoi(row.tags);
    const servesFood = isFoodVenue(row.tags);
    // Live provider hours are preferred over the stored snapshot when both exist; the snapshot is
    // what the catalog is permitted to retain, the live result is fresher. An expired snapshot is
    // dropped entirely rather than shown as current -- the card then reads "Hours unverified",
    // matching exactly what the server-side placement check will decide.
    const storedHours = isSnapshotUsable(row.providerHoursExpiresAt, input.now ?? new Date()) ? row.providerHours : null;
    const hours = match?.providerHours ?? storedHours;
    const businessStatus = match?.businessStatus ?? row.businessStatus;
    candidates.push({
      key: row.id,
      poiId: row.id,
      providerPlaceId: row.providerPlaceId ?? match?.providerPlaceId ?? null,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      category,
      trust: trustFor(row),
      shortDescription: row.shortDescription,
      providerDescription: match?.providerDescription ?? null,
      attribution: match?.attribution ?? null,
      officialUrl: row.officialUrl,
      googleMapsUri: match?.googleMapsUri ?? null,
      sourceUrl: row.sourceUrl,
      sourceNote: row.sourceNote,
      verifiedAt: row.verifiedAt,
      costTier: row.costTier,
      halalStatus: row.halalStatus,
      allergenRisk: row.allergenRisk,
      allergenDataUnknown: row.allergenDataUnknown,
      dressCode: row.dressCode,
      servesFood,
      defaultDurationMinutes: defaultVisitMinutes(category),
      openingStatus: openingStatusForDate(hours, businessStatus, input.selectedDate),
      eligibility: evaluateEligibility({
        servesFood,
        halalStatus: row.halalStatus,
        allergenRisk: row.allergenRisk,
        allergenDataUnknown: row.allergenDataUnknown,
        dressCode: row.dressCode,
        category,
      }, input.confirmedConstraints, input.travelerCaps),
      travelMinutesFromPrevious: null,
    });
  }

  for (const result of provider) {
    if (consumedProviderIds.has(result.providerPlaceId)) continue;
    const category = categorizePoi(result.tags);
    const servesFood = isFoodVenue(result.tags);
    // A provider-only venue has no owned safety evidence at all, so every safety field is unknown.
    // The gate then fails it closed for a confirmed severe constraint, which is the point.
    candidates.push({
      key: "provider:" + result.providerPlaceId,
      poiId: null,
      providerPlaceId: result.providerPlaceId,
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      category,
      trust: "provider",
      shortDescription: null,
      providerDescription: result.providerDescription,
      attribution: result.attribution,
      officialUrl: null,
      googleMapsUri: result.googleMapsUri,
      sourceUrl: null,
      sourceNote: null,
      verifiedAt: null,
      costTier: "standard",
      halalStatus: "unknown",
      allergenRisk: [],
      allergenDataUnknown: true,
      dressCode: "none",
      servesFood,
      defaultDurationMinutes: defaultVisitMinutes(category),
      openingStatus: openingStatusForDate(result.providerHours, result.businessStatus, input.selectedDate),
      eligibility: evaluateEligibility({
        servesFood,
        halalStatus: "unknown",
        allergenRisk: [],
        allergenDataUnknown: true,
        dressCode: "none",
        category,
      }, input.confirmedConstraints, input.travelerCaps),
      travelMinutesFromPrevious: null,
    });
  }

  return candidates;
}

function evaluateEligibility(
  venue: { servesFood: boolean; halalStatus: HalalStatus; allergenRisk: readonly string[]; allergenDataUnknown: boolean; dressCode: DressCode; category: PoolCategory },
  confirmedConstraints: readonly ConfirmedConstraintFlag[],
  travelerCaps: readonly TravelerConstraintProfile[],
): { result: "pass" | "warn" | "fail"; reasons: readonly GateReason[] } {
  const outcome = evaluateConstraintGate(
    {
      // Gate on food-serving, not on display category -- see isFoodVenue.
      category: venue.servesFood ? "food" : itemTypeForCategory(venue.category),
      estimatedCost: 0,
      halalStatus: venue.servesFood ? venue.halalStatus : undefined,
      allergenRisk: venue.servesFood ? venue.allergenRisk : undefined,
      allergenDataUnknown: venue.servesFood ? venue.allergenDataUnknown : undefined,
      dressCode: venue.dressCode,
      legDistanceM: null,
      overlapsPrecedingActivity: false,
      crossesMidnight: false,
      missesConsensusAnchorArrival: null,
    },
    confirmedConstraints,
    travelerCaps,
  );
  return { result: outcome.result, reasons: outcome.reasons };
}

/** Case-insensitive substring search over the fields a traveler would actually search by. */
export function searchCandidates(candidates: readonly PoolCandidate[], query: string): PoolCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...candidates];
  return candidates.filter((candidate) =>
    candidate.name.toLowerCase().includes(needle)
    || (candidate.shortDescription ?? "").toLowerCase().includes(needle)
    || candidate.category.includes(needle));
}

export function candidatesInCategory(candidates: readonly PoolCandidate[], category: PoolCategory | "all"): PoolCandidate[] {
  return category === "all" ? [...candidates] : candidates.filter((candidate) => candidate.category === category);
}
