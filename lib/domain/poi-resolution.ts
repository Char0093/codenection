import { ALLERGEN_DIETARY_FLAGS, type ConfirmedConstraintFlag, type HalalStatus, type DressCode } from "@/lib/domain/constraint-gate";

/**
 * Implementation_Plan.md Task 1.1's reference corridor is the only ground truth poi_catalog has.
 * Grounding a Gemini-proposed food activity against a real, verified POI is only possible when the
 * trip's destination falls inside one of these three named regions; everywhere else stays
 * conservatively "unknown" (see gemini-proposal-validation.ts), which is honest, not a bug.
 */
export const POI_CATALOG_REGIONS = ["KLCC", "Bukit Bintang", "Old Town/Melaka"] as const;
export type PoiCatalogRegion = (typeof POI_CATALOG_REGIONS)[number];

/** Deterministic, pure region inference from free-text destination input. Never guesses a region
 * from a generic "Kuala Lumpur" -- KLCC and Bukit Bintang are both areas within KL, and matching
 * the city name alone would overclaim candidate coverage the seed data doesn't actually have. */
export function inferPoiRegion(destinationName: string): PoiCatalogRegion | null {
  const normalized = destinationName.toLowerCase();
  if (/\bmelaka\b|\bmalacca\b/.test(normalized)) return "Old Town/Melaka";
  if (/\bklcc\b|kuala lumpur city cent(re|er)/.test(normalized)) return "KLCC";
  if (/\bbukit bintang\b/.test(normalized)) return "Bukit Bintang";
  return null;
}

export type CandidatePoi = {
  name: string;
  halalStatus: HalalStatus;
  allergenRisk: readonly string[];
  allergenDataUnknown: boolean;
  dressCode: DressCode;
};

/** Strips a trailing parenthetical qualifier, e.g. "Seri Nyonya Restaurant (Hotel Equatorial
 * Melaka)" -> "seri nyonya restaurant", so a shorter Gemini-written title can still match the
 * venue's common name without the qualifier. */
function coreName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
}

const MIN_MATCHABLE_NAME_LENGTH = 6;

/**
 * Deterministic, conservative name match between a Gemini-written activity title and the known
 * candidate POIs for the trip's region. This is the only mechanism that lets a food activity's
 * halal_status/allergen_risk come from a real, verified poi_catalog row instead of the
 * always-unknown default -- so it deliberately only matches in the safer direction (the
 * candidate's whole core name must appear inside the activity title) and ignores any candidate
 * name too short/generic to be a meaningful signal, to avoid mis-attributing one venue's safety
 * data to an unrelated activity.
 */
export function matchPoiByName(activityTitle: string, candidates: readonly CandidatePoi[]): CandidatePoi | null {
  const title = activityTitle.trim().toLowerCase();
  for (const candidate of candidates) {
    const name = coreName(candidate.name);
    if (name.length < MIN_MATCHABLE_NAME_LENGTH) continue;
    if (title === name || title.includes(name)) return candidate;
  }
  return null;
}

/**
 * Narrows a region's candidate POIs down to only those safe enough to *suggest* to Gemini, so the
 * model is never even offered a venue the hard-constraint gate (Section VII) would reject anyway.
 * This changes only what gets suggested -- the gate remains the sole authority on what gets
 * accepted, and matchPoiByName/the gate must keep running against the *unfiltered* candidate list
 * at validation time, so a venue Gemini names despite not being hinted (or invents outright) is
 * still checked against its own real data rather than silently defaulting to unknown.
 *
 * halal and allergen constraints are filtered independently, matching the gate's own per-dimension
 * independence: a confirmed allergen alone must never narrow the hint by halal_status, and a
 * confirmed halal constraint must never narrow it by allergen data. A standard-severity (not
 * severe) allergen constraint does not filter the hint, since the gate itself only warns, not
 * fails, on unknown allergen data at standard severity -- suggesting such a venue is still honest.
 */
export function filterCandidatePoisForConstraints(
  candidates: readonly CandidatePoi[],
  confirmedConstraints: readonly ConfirmedConstraintFlag[],
): CandidatePoi[] {
  const halalConfirmed = confirmedConstraints.some((c) => c.kind === "dietary" && c.flag === "halal");
  const severeAllergenFlags = confirmedConstraints
    .filter((c) => c.kind === "dietary" && c.severity === "severe" && (ALLERGEN_DIETARY_FLAGS as readonly string[]).includes(c.flag))
    .map((c) => c.flag);

  return candidates.filter((poi) => {
    if (halalConfirmed && poi.halalStatus !== "verified") return false;
    if (severeAllergenFlags.length > 0) {
      if (poi.allergenDataUnknown) return false;
      if (severeAllergenFlags.some((flag) => poi.allergenRisk.includes(flag))) return false;
    }
    return true;
  });
}
