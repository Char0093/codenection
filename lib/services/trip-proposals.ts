import "server-only";
import { tripInputSchema, type TripInput } from "@/lib/domain/trip";
import { validateGeminiProposal } from "@/lib/domain/gemini-proposal-validation";
import type { GeminiTripProposal } from "@/lib/gemini/types";
import type { TripRepository } from "@/lib/repositories/planning-repository";
import { AppError } from "@/lib/http/errors";

export async function generateProposal(
  tripId: string,
  repository: TripRepository,
  planner: (input: TripInput) => Promise<{ proposal: GeminiTripProposal; model: string }>,
) {
  const trip = await repository.getTrip(tripId);
  if (trip.role !== "owner" && trip.role !== "planner") throw new AppError(403, "Only the owner or a planner can generate a proposal.", "FORBIDDEN");
  const input = tripInputSchema.parse({ destinationName: trip.destinationName, startDate: trip.startDate, endDate: trip.endDate, budgetTier: trip.budgetTier, pace: trip.pace, notes: trip.notes });
  await repository.reserveGeneration(trip.id);
  const { proposal, model } = await planner(input);
  const validated = validateGeminiProposal(input, proposal, trip.role);
  return repository.saveProposal(trip, validated, model);
}
