import type { ConstraintSeverity } from "@/lib/domain/constraints";

/**
 * Implementation_Plan.md Section VII / Task 1.4: the single deterministic gate every candidate
 * item -- from Gemini, from a solver, from a detour -- must pass before it is stored or shown as
 * approved. Never delegated to an LLM. Pure: no I/O, no clock reads, no randomness.
 *
 * Scoping note on Budget and Time: Section VII describes both as aggregate concerns ("the
 * selected set's cost", "no overlap" between activities), not single-item facts. This function
 * stays a pure per-item check as Task 1.4 specifies, so the caller is responsible for computing
 * the aggregate inputs before calling it: `remainingBudget` is "how much this traveler has left
 * after every other already-committed item", and the time flags are pre-computed from the full
 * day's sorted schedule (exactly what the existing per-day loop in gemini-proposal-validation.ts
 * already computes). The gate itself only ever does the final deterministic comparison.
 */

export type GateResultKind = "pass" | "warn" | "fail";

export type GateReason = { dimension: "dietary" | "halal" | "dress_code" | "budget" | "mobility" | "time"; message: string };

export type GateOutcome = { result: GateResultKind; reasons: readonly GateReason[] };

export type HalalStatus = "verified" | "claimed" | "unknown" | "no";
export type DressCode = "none" | "modest";
export type ActivityCategory = "culture" | "food" | "nature" | "shopping" | "transit";

/** Allergen-type dietary flags the gate checks against `allergenRisk`. Distinct from halal/
 * vegetarian/vegan/other, which are not "an allergen flag" per Section VII's own wording -- those
 * would need poi_catalog to carry separate meat/dairy-content facts it does not have yet. */
export const ALLERGEN_DIETARY_FLAGS = ["no_seafood", "no_shellfish", "no_pork", "no_beef", "no_dairy", "no_gluten", "no_peanut"] as const;

export type ConfirmedConstraintFlag = {
  kind: "dietary" | "religious_access" | "mobility";
  flag: string;
  severity: ConstraintSeverity;
};

/** Per-traveler figures the caller has already computed from traveler_profiles plus whatever
 * has already been committed to the schedule. `null` means "no cap set / not tracked" -- a
 * missing cap can never itself cause a rejection. */
export type TravelerConstraintProfile = {
  tripMemberId: string;
  remainingBudget: number | null;
  mobilityThresholdM: number | null;
};

/** Raw persisted caps from traveler_profiles (via trip_member_budget_mobility_caps), before a
 * caller derives a per-item TravelerConstraintProfile.remainingBudget from running totals. */
export type TravelerCapRow = {
  tripMemberId: string;
  budgetDailyCap: number | null;
  budgetTotalCap: number | null;
  mobilityThresholdM: number | null;
};

export type GateItem = {
  category: ActivityCategory;
  /** Conservative absolute cost estimate for this single item, in the trip's base currency. */
  estimatedCost: number;
  /** Only consulted when category === "food". Absent/undefined is treated as unknown. */
  halalStatus?: HalalStatus;
  allergenRisk?: readonly string[];
  /** Defaults to true (no verified basis) when absent -- mirrors poi_catalog's own default. */
  allergenDataUnknown?: boolean;
  dressCode?: DressCode;
  /** Distance of the leg arriving at this item, if known. */
  legDistanceM?: number | null;
  /** Pre-computed by the caller from the full day's sorted schedule. */
  overlapsPrecedingActivity?: boolean;
  crossesMidnight?: boolean;
  /** Phase 4 (split/merge) concept; null/absent means not applicable yet. */
  missesConsensusAnchorArrival?: boolean | null;
};

function worse(a: GateResultKind, b: GateResultKind): GateResultKind {
  if (a === "fail" || b === "fail") return "fail";
  if (a === "warn" || b === "warn") return "warn";
  return "pass";
}

export function evaluateConstraintGate(
  item: GateItem,
  confirmedConstraints: readonly ConfirmedConstraintFlag[],
  travelerCaps: readonly TravelerConstraintProfile[],
): GateOutcome {
  let result: GateResultKind = "pass";
  const reasons: GateReason[] = [];

  // --- Dietary (allergens) + Halal: only meaningful for food items ---
  if (item.category === "food") {
    const allergenUnknown = item.allergenDataUnknown ?? item.allergenRisk === undefined;
    const allergenRisk = item.allergenRisk ?? [];
    for (const confirmed of confirmedConstraints) {
      if (confirmed.kind !== "dietary") continue;
      if ((ALLERGEN_DIETARY_FLAGS as readonly string[]).includes(confirmed.flag)) {
        if (allergenUnknown) {
          const dimResult = confirmed.severity === "severe" ? "fail" : "warn";
          result = worse(result, dimResult);
          reasons.push({ dimension: "dietary", message: `Allergen data is unknown for a food item, and ${confirmed.flag} is a confirmed ${confirmed.severity} constraint.` });
        } else if (allergenRisk.includes(confirmed.flag)) {
          result = worse(result, "fail");
          reasons.push({ dimension: "dietary", message: `Item lists ${confirmed.flag} in allergen_risk, which is a confirmed constraint.` });
        }
      } else if (confirmed.flag === "halal") {
        const halalStatus = item.halalStatus ?? "unknown";
        if (halalStatus === "claimed") {
          result = worse(result, "warn");
          reasons.push({ dimension: "halal", message: "Halal status is only self-claimed by the venue, not independently verified." });
        } else if (halalStatus === "unknown" || halalStatus === "no") {
          result = worse(result, "fail");
          reasons.push({ dimension: "halal", message: `Halal is a confirmed constraint but the item's halal_status is '${halalStatus}'.` });
        }
      }
    }
  }

  // --- Religious access / dress code: never silently scheduled ---
  if (item.dressCode === "modest") {
    result = worse(result, "warn");
    reasons.push({ dimension: "dress_code", message: "Item requires modest dress; a packing item and pre-visit reminder are required, not a silent schedule." });
  }

  // --- Budget: caller supplies remaining headroom per affected traveler ---
  for (const traveler of travelerCaps) {
    if (traveler.remainingBudget === null) continue;
    if (item.estimatedCost > traveler.remainingBudget) {
      result = worse(result, "fail");
      reasons.push({ dimension: "budget", message: `Estimated cost ${item.estimatedCost} exceeds traveler ${traveler.tripMemberId}'s remaining budget of ${traveler.remainingBudget}.` });
    }
  }

  // --- Mobility ---
  if (item.legDistanceM != null) {
    const mobilitySeverity = confirmedConstraints.find((c) => c.kind === "mobility")?.severity;
    for (const traveler of travelerCaps) {
      if (traveler.mobilityThresholdM === null) continue;
      if (item.legDistanceM > traveler.mobilityThresholdM) {
        const dimResult = mobilitySeverity === "severe" ? "fail" : "warn";
        result = worse(result, dimResult);
        reasons.push({ dimension: "mobility", message: `Leg of ${item.legDistanceM}m exceeds traveler ${traveler.tripMemberId}'s mobility threshold of ${traveler.mobilityThresholdM}m.` });
      }
    }
  }

  // --- Time ---
  if (item.overlapsPrecedingActivity) {
    result = worse(result, "fail");
    reasons.push({ dimension: "time", message: "Item overlaps the preceding activity." });
  }
  if (item.crossesMidnight) {
    result = worse(result, "fail");
    reasons.push({ dimension: "time", message: "Item crosses the midnight day boundary." });
  }
  if (item.missesConsensusAnchorArrival) {
    result = worse(result, "fail");
    reasons.push({ dimension: "time", message: "Item arrives at the consensus anchor later than the convergence time." });
  }

  return { result, reasons };
}
