import type { TripInput } from "@/lib/domain/trip";
import type { TripRole } from "@/lib/domain/proposal";
import type { GeminiTripProposal } from "@/lib/gemini/types";

export type { TripInput } from "@/lib/domain/trip";

export type TripRecord = TripInput & {
  id: string;
  ownerUserId: string;
  role: TripRole;
  revision: number;
  activeProposalId: string | null;
};

export type ProposalRecord = {
  id: string;
  tripId: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  payload: GeminiTripProposal;
  model: string;
  createdAt: string;
  expiresAt: string;
  tripRevision: number;
};

export interface TripRepository {
  createTrip(input: TripInput): Promise<TripRecord>;
  getTrip(tripId: string): Promise<TripRecord>;
  updateTrip(tripId: string, input: TripInput): Promise<TripRecord>;
  listTrips(): Promise<TripRecord[]>;
  listProposals(tripId: string): Promise<ProposalRecord[]>;
  reserveGeneration(tripId: string): Promise<void>;
  saveProposal(trip: TripRecord, payload: GeminiTripProposal, model: string): Promise<ProposalRecord>;
  decideProposal(tripId: string, proposalId: string, decision: "accept" | "reject"): Promise<ProposalRecord>;
}
