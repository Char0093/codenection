import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/http/errors";
import { inferPoiRegion } from "@/lib/domain/poi-resolution";
import { evaluateConstraintGate } from "@/lib/domain/constraint-gate";
import { getPoiForScheduling } from "@/lib/poi/repository";
import { categorizePoi, isFoodVenue, itemTypeForCategory } from "@/lib/poi/choice-pool";
import { evaluateDrop, isSnapshotUsable, openingStatusForDate, timeStringToMinutes } from "@/lib/poi/opening-hours";
import type { TripRepository } from "@/lib/repositories/planning-repository";

/**
 * Server-side placement enforcement for Task 3.4.
 *
 * The pool UI already refuses to drag a gate-failed candidate and shades infeasible times, but that
 * is a *usability* affordance, not a control: a crafted request straight to the schedule/reorder
 * routes would otherwise place a POI the hard-constraint gate rejects, a POI belonging to a
 * different city than the trip, or a visit outside the venue's opening hours. This module is the
 * actual boundary.
 *
 * It runs in the route rather than in plpgsql on purpose. Section VII's gate is deliberately one
 * deterministic TypeScript function, and the proposal path (`validateGeminiProposal`) already
 * enforces it in the same place; reimplementing halal/allergen reasoning in SQL would create
 * exactly the second, drifting copy the codebase has avoided elsewhere.
 */

export type PlacementCheck = {
  /** Passed to the RPC so the database stores the caller's canonical category, not a client claim. */
  itemType: string;
  /** Present when the visit is allowed but the venue's hours could not be verified. */
  hoursWarning?: string;
};

export async function assertPlacementAllowed(
  client: SupabaseClient,
  repository: TripRepository,
  input: { tripId: string; poiId: string; localDate: string; startTime: string; durationMinutes: number },
  now: Date = new Date(),
): Promise<PlacementCheck> {
  const [trip, found] = await Promise.all([
    repository.getTrip(input.tripId),
    getPoiForScheduling(client, input.poiId),
  ]);
  if (!found) throw new AppError(404, "That place could not be found.", "NOT_FOUND");
  const { poi, region } = found;

  // A place from another city must never land on this trip, however the request was constructed.
  const tripRegion = inferPoiRegion(trip.destinationName);
  if (!tripRegion || tripRegion !== region) {
    throw new AppError(422, `${poi.name} is not in this trip's destination.`, "VALIDATION_FAILED");
  }

  const [confirmedConstraints, travelerCaps] = await Promise.all([
    repository.listConfirmedConstraints(input.tripId),
    repository.listTravelerCaps(input.tripId),
  ]);

  const category = categorizePoi(poi.tags);
  const servesFood = isFoodVenue(poi.tags);
  const outcome = evaluateConstraintGate(
    {
      // Gate on food-serving, not display category -- a mall filed under Shopping still serves food.
      category: servesFood ? "food" : itemTypeForCategory(category),
      estimatedCost: 0,
      halalStatus: servesFood ? poi.halalStatus : undefined,
      allergenRisk: servesFood ? poi.allergenRisk : undefined,
      allergenDataUnknown: servesFood ? poi.allergenDataUnknown : undefined,
      dressCode: poi.dressCode,
      legDistanceM: null,
      overlapsPrecedingActivity: false,
      crossesMidnight: false,
      missesConsensusAnchorArrival: null,
    },
    confirmedConstraints,
    travelerCaps.map((cap) => ({
      tripMemberId: cap.tripMemberId, remainingBudget: null, mobilityThresholdM: cap.mobilityThresholdM,
    })),
  );
  if (outcome.result === "fail") {
    throw new AppError(422, outcome.reasons[0]?.message ?? "A confirmed constraint rules this place out.", "VALIDATION_FAILED");
  }

  // An expired provider snapshot is treated as absent rather than quietly reused, so a stale cache
  // can never be the thing that says a venue was open.
  const usableHours = isSnapshotUsable(poi.providerHoursExpiresAt, now) ? poi.providerHours : null;
  const status = openingStatusForDate(usableHours, poi.businessStatus, input.localDate);
  const feasibility = evaluateDrop(status, timeStringToMinutes(input.startTime), input.durationMinutes);
  if (!feasibility.droppable) {
    throw new AppError(422, feasibility.reason, "VALIDATION_FAILED");
  }

  return { itemType: itemTypeForCategory(category), hoursWarning: feasibility.warning };
}
