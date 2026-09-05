import "server-only";
import { tripInputSchema, type TripInput } from "@/lib/domain/trip";
import { validateGeminiProposal } from "@/lib/domain/gemini-proposal-validation";
import { inferPoiRegion, filterCandidatePoisForConstraints, type CandidatePoi } from "@/lib/domain/poi-resolution";
import type { GeminiTripProposal } from "@/lib/gemini/types";
import type { TripRepository } from "@/lib/repositories/planning-repository";
import { AppError } from "@/lib/http/errors";

export async function generateProposal(
  tripId: string,
  repository: TripRepository,
  planner: (input: TripInput, candidatePois: readonly CandidatePoi[]) => Promise<{ proposal: GeminiTripProposal; model: string }>,
) {
  const trip = await repository.getTrip(tripId);
  if (trip.role !== "owner" && trip.role !== "planner") throw new AppError(403, "Only the owner or a planner can generate a proposal.", "FORBIDDEN");
  const input = tripInputSchema.parse({ destinationName: trip.destinationName, startDate: trip.startDate, endDate: trip.endDate, budgetTier: trip.budgetTier, pace: trip.pace, notes: trip.notes });
  await repository.reserveGeneration(trip.id);
  const [confirmedConstraints, travelerCaps] = await Promise.all([
    repository.listConfirmedConstraints(trip.id),
    repository.listTravelerCaps(trip.id),
  ]);
  // POI grounding (Implementation_Plan.md Task 1.1/5.x, pulled forward): only the reference
  // corridor has real safety data, so an unmatched destination gets an empty candidate list --
  // gemini-proposal-validation.ts's existing conservative "unknown" default is unchanged there.
  const poiRegion = inferPoiRegion(trip.destinationName);
  const regionCandidates = poiRegion ? await repository.listPoisByRegion(poiRegion) : [];
  // Only *suggest* venues the confirmed constraints can't already rule out -- the gate below still
  // independently checks every activity against the full, unfiltered candidate list, so this never
  // becomes a trust boundary, only a better-quality suggestion.
  const hintCandidates = filterCandidatePoisForConstraints(regionCandidates, confirmedConstraints);
  const { proposal, model } = await planner(input, hintCandidates);
  const { proposal: validated } = validateGeminiProposal(input, proposal, trip.role, confirmedConstraints, travelerCaps, regionCandidates);
  return repository.saveProposal(trip, validated, model);
}
