import { tripInputSchema } from "@/lib/domain/trip";
import { budgetRank, paceDailyDurationCaps } from "@/lib/domain/itinerary";
import { geminiTripProposalSchema } from "@/lib/gemini/schemas";
import { evaluateConstraintGate, type ConfirmedConstraintFlag, type GateReason, type TravelerCapRow } from "@/lib/domain/constraint-gate";
import { matchPoiByName, type CandidatePoi } from "@/lib/domain/poi-resolution";
import type { GeminiActivity, GeminiTripProposal } from "@/lib/gemini/types";

export class GeminiProposalValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "GeminiProposalValidationError";
    this.errors = [...errors];
  }
}

export type GeminiProposalValidationResult = {
  proposal: GeminiTripProposal;
  /**
   * Section VII "warn" outcomes from the hard-constraint gate, e.g. a claimed-but-unverified halal
   * status or a dress-code reminder. These do not block generation (only "fail" does) but are not
   * yet surfaced to a human reviewer anywhere in the UI -- that is a follow-up, not part of Task
   * 1.4's own scope. Never silently discard these; a future task must either display them or fold
   * them into the assistant-proposal-card review flow.
   */
  gateWarnings: readonly GateReason[];
};

export function validateGeminiProposal(
  input: unknown,
  proposal: unknown,
  role: unknown,
  confirmedConstraints: readonly ConfirmedConstraintFlag[] = [],
  travelerCaps: readonly TravelerCapRow[] = [],
  candidatePois: readonly CandidatePoi[] = [],
): GeminiProposalValidationResult {
  if (role !== "owner" && role !== "planner") {
    throw new GeminiProposalValidationError(["Only a trip owner or planner may generate a proposal."]);
  }
  const trip = tripInputSchema.parse(input);
  const parsed = geminiTripProposalSchema.parse(proposal);
  const days = new Map<string, GeminiActivity[]>();
  for (const activity of parsed.activities) {
    if (activity.date < trip.startDate || activity.date > trip.endDate) {
      throw new GeminiProposalValidationError([`Activity date ${activity.date} is outside the trip date range.`]);
    }
    if (budgetRank[activity.estimatedCostTier] > budgetRank[trip.budgetTier]) {
      throw new GeminiProposalValidationError([`Activity on ${activity.date} at ${activity.startTime} exceeds the trip budget tier.`]);
    }
    const dailyActivities = days.get(activity.date) ?? [];
    dailyActivities.push(activity);
    days.set(activity.date, dailyActivities);
  }
  // Budget/mobility per-item numeric enforcement is deliberately inert today: Gemini activities
  // carry only a cost *tier*, not a POI-linked numeric cost or leg distance, so there is nothing
  // honest to compare traveler_profiles' numeric caps against yet (Task 2.3's Knapsack pricing and
  // POI-linked distances are the real inputs those dimensions need). remainingBudget/legDistanceM
  // stay null/unset below, which the gate treats as "no applicable cap" -- not as "cap satisfied".
  const travelerProfiles = travelerCaps.map((cap) => ({ tripMemberId: cap.tripMemberId, remainingBudget: null, mobilityThresholdM: cap.mobilityThresholdM }));
  const gateWarnings: GateReason[] = [];

  for (let timestamp = Date.parse(trip.startDate); timestamp <= Date.parse(trip.endDate); timestamp += 86_400_000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const activities = days.get(date);
    if (!activities?.length) throw new GeminiProposalValidationError([`Missing activities for trip day ${date}.`]);
    activities.sort((left, right) => left.startTime.localeCompare(right.startTime));
    let previousEnd = 0;
    let totalDuration = 0;
    for (const activity of activities) {
      const [hours, minutes] = activity.startTime.split(":").map(Number);
      const start = hours * 60 + minutes;
      const end = start + activity.durationMinutes;

      // A food activity is only ever as safe as a real, verified poi_catalog match: if the
      // activity's title deterministically matches one of the trip's reference-corridor
      // candidates (see lib/domain/poi-resolution.ts), that venue's own halal_status/
      // allergen_risk/dress_code are used. Otherwise -- an unmatched destination, or Gemini
      // naming a venue outside the supplied candidates -- the data is honestly unknown, never
      // invented as "presumably fine".
      const matchedPoi = activity.category === "food" ? matchPoiByName(activity.title, candidatePois) : null;

      // The hard-constraint gate (Section VII) is the single authority for overlap/midnight/
      // dietary/halal decisions here, rather than duplicating the overlap/midnight checks in a
      // second, parallel implementation that could drift from the gate's own logic.
      const outcome = evaluateConstraintGate(
        {
          category: activity.category,
          estimatedCost: 0,
          halalStatus: activity.category === "food" ? (matchedPoi?.halalStatus ?? "unknown") : undefined,
          allergenRisk: matchedPoi?.allergenRisk,
          allergenDataUnknown: activity.category === "food" ? (matchedPoi?.allergenDataUnknown ?? true) : undefined,
          dressCode: matchedPoi?.dressCode ?? "none",
          legDistanceM: null,
          overlapsPrecedingActivity: start < previousEnd,
          crossesMidnight: end > 1440,
          missesConsensusAnchorArrival: null,
        },
        confirmedConstraints,
        travelerProfiles,
      );
      if (outcome.result === "fail") {
        throw new GeminiProposalValidationError(outcome.reasons.map((reason) => `Activity on ${date} at ${activity.startTime}: ${reason.message}`));
      }
      gateWarnings.push(...outcome.reasons);

      previousEnd = end;
      totalDuration += activity.durationMinutes;
    }
    if (totalDuration > paceDailyDurationCaps[trip.pace]) {
      throw new GeminiProposalValidationError([`Daily activity duration on ${date} exceeds the ${trip.pace} pace duration cap of ${paceDailyDurationCaps[trip.pace]} minutes.`]);
    }
  }
  return { proposal: parsed, gateWarnings };
}
