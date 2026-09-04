import "server-only";
import { randomUUID } from "crypto";
import { AppError } from "@/lib/http/errors";
import type { GeminiTripProposal } from "@/lib/gemini/types";
import { tripInputSchema, type TripInput } from "@/lib/domain/trip";
import type { MockAccount } from "@/lib/mock/accounts";
import type { ProposalRecord, TripRecord, TripRepository } from "@/lib/repositories/planning-repository";

const sharedTripId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type StoredTrip = Omit<TripRecord, "role">;
type Store = {
  trips: StoredTrip[];
  proposals: ProposalRecord[];
};

const initialProposal: GeminiTripProposal = {
  summary: "A compact Penang food and culture plan for comparing role permissions without live Gemini.",
  assumptions: ["Opening hours and prices should be verified before travel.", "Transfers are estimated for demo use only."],
  activities: [
    {
      title: "Pinang Peranakan Mansion",
      category: "culture",
      date: "2026-10-03",
      startTime: "10:00",
      durationMinutes: 90,
      estimatedCostTier: "standard",
      rationale: "Starts with a focused museum visit near George Town's core.",
      contingencyNote: "Swap for a nearby gallery if tickets are unavailable.",
    },
    {
      title: "Kimberley Street dinner",
      category: "food",
      date: "2026-10-03",
      startTime: "18:30",
      durationMinutes: 75,
      estimatedCostTier: "budget",
      rationale: "Keeps the evening flexible with several nearby food options.",
      contingencyNote: "Use a covered hawker centre if weather is poor.",
    },
    {
      title: "Penang Botanic Gardens",
      category: "nature",
      date: "2026-10-04",
      startTime: "09:30",
      durationMinutes: 90,
      estimatedCostTier: "budget",
      rationale: "Adds a slower outdoor morning that fits the balanced pace.",
      contingencyNote: "Replace with a covered market visit during heavy rain.",
    },
    {
      title: "Armenian Street browse",
      category: "shopping",
      date: "2026-10-05",
      startTime: "10:30",
      durationMinutes: 75,
      estimatedCostTier: "standard",
      rationale: "Leaves time for a final low-commitment neighborhood stop.",
      contingencyNote: "Shorten the stop if checkout or transfers take longer.",
    },
  ],
};

function makeStore(): Store {
  return {
    trips: [{
      id: sharedTripId,
      ownerUserId: "11111111-1111-4111-8111-111111111111",
      destinationName: "George Town, Penang",
      startDate: "2026-10-03",
      endDate: "2026-10-05",
      budgetTier: "standard",
      pace: "balanced",
      notes: "Museums, food markets, and short transfers.",
      revision: 1,
      activeProposalId: null,
    }],
    proposals: [{
      id: proposalId,
      tripId: sharedTripId,
      status: "pending",
      payload: initialProposal,
      model: "mock-gemini",
      createdAt: "2026-09-04T00:00:00.000Z",
      expiresAt: "2026-12-31T23:59:59.000Z",
      tripRevision: 1,
    }],
  };
}

const globalState = globalThis as typeof globalThis & { __waypointMockStore?: Store };

function store(): Store {
  globalState.__waypointMockStore ??= makeStore();
  return globalState.__waypointMockStore;
}

function withRole(trip: StoredTrip, account: MockAccount): TripRecord {
  return { ...trip, role: trip.ownerUserId === account.id ? "owner" : account.role };
}

function cloneProposal(proposal: ProposalRecord): ProposalRecord {
  return { ...proposal, payload: { ...proposal.payload, activities: proposal.payload.activities.map((activity) => ({ ...activity })), assumptions: [...proposal.payload.assumptions] } };
}

export class MockTripRepository implements TripRepository {
  constructor(private readonly account: MockAccount) {}

  async createTrip(input: TripInput): Promise<TripRecord> {
    const parsed = tripInputSchema.parse(input);
    const trip: StoredTrip = {
      ...parsed,
      id: randomUUID(),
      ownerUserId: this.account.id,
      revision: 1,
      activeProposalId: null,
    };
    store().trips.unshift(trip);
    return withRole(trip, this.account);
  }

  async getTrip(tripId: string): Promise<TripRecord> {
    const trip = store().trips.find((item) => item.id === tripId);
    if (!trip) throw new AppError(404, "Trip or proposal not found.", "NOT_FOUND");
    return withRole(trip, this.account);
  }

  async updateTrip(tripId: string, input: TripInput): Promise<TripRecord> {
    const trip = await this.getTrip(tripId);
    if (trip.role !== "owner" && trip.role !== "planner") throw new AppError(403, "Only the owner or a planner can edit this trip.", "FORBIDDEN");
    const parsed = tripInputSchema.parse(input);
    const stored = store().trips.find((item) => item.id === tripId);
    if (!stored) throw new AppError(404, "Trip or proposal not found.", "NOT_FOUND");
    Object.assign(stored, parsed, { revision: stored.revision + 1 });
    return withRole(stored, this.account);
  }

  async listTrips(): Promise<TripRecord[]> {
    return store().trips.map((trip) => withRole(trip, this.account));
  }

  async listProposals(tripId: string): Promise<ProposalRecord[]> {
    await this.getTrip(tripId);
    return store().proposals.filter((proposal) => proposal.tripId === tripId).map(cloneProposal);
  }

  async reserveGeneration(tripId: string): Promise<void> {
    const trip = await this.getTrip(tripId);
    if (trip.role !== "owner" && trip.role !== "planner") throw new AppError(403, "Only the owner or a planner can generate a proposal.", "FORBIDDEN");
  }

  async saveProposal(trip: TripRecord, payload: GeminiTripProposal, model: string): Promise<ProposalRecord> {
    const proposal: ProposalRecord = {
      id: randomUUID(),
      tripId: trip.id,
      status: "pending",
      payload,
      model,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      tripRevision: trip.revision,
    };
    store().proposals.unshift(proposal);
    return cloneProposal(proposal);
  }

  async decideProposal(tripId: string, proposalIdValue: string, decision: "accept" | "reject"): Promise<ProposalRecord> {
    const trip = await this.getTrip(tripId);
    if (trip.role !== "owner") throw new AppError(403, "Only a trip owner can activate this proposal.", "FORBIDDEN");
    const proposal = store().proposals.find((item) => item.id === proposalIdValue && item.tripId === tripId);
    if (!proposal) throw new AppError(404, "Trip or proposal not found.", "NOT_FOUND");
    if (proposal.status !== "pending") throw new AppError(409, "This proposal is no longer current. Reload the trip and generate a new proposal.", "CONFLICT");
    proposal.status = decision === "accept" ? "accepted" : "rejected";
    if (proposal.status === "accepted") {
      const stored = store().trips.find((item) => item.id === tripId);
      if (stored) stored.activeProposalId = proposal.id;
      for (const other of store().proposals) {
        if (other.tripId === tripId && other.id !== proposal.id && other.status === "pending") other.status = "expired";
      }
    }
    return cloneProposal(proposal);
  }
}

export async function mockPlanTrip(input: TripInput): Promise<{ proposal: GeminiTripProposal; model: string }> {
  const parsed = tripInputSchema.parse(input);
  const activities: GeminiTripProposal["activities"] = [];
  for (let timestamp = Date.parse(parsed.startDate); timestamp <= Date.parse(parsed.endDate); timestamp += 86_400_000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    activities.push({
      title: `${parsed.destinationName} orientation stop`,
      category: "culture",
      date,
      startTime: "10:00",
      durationMinutes: parsed.pace === "relaxed" ? 60 : 90,
      estimatedCostTier: parsed.budgetTier,
      rationale: "Gives the group a low-risk activity for reviewing the generated-plan workflow.",
      contingencyNote: "Move indoors if weather or access changes.",
    });
  }
  return {
    model: "mock-gemini",
    proposal: {
      summary: `Mock proposal for ${parsed.destinationName}, covering ${parsed.startDate} to ${parsed.endDate}.`,
      assumptions: ["This mock response is deterministic and does not contact Gemini.", "Validate local details before using the itinerary."],
      activities,
    },
  };
}
