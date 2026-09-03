import type { ProposalRecord, TripRecord } from "@/lib/repositories/planning-repository";

export const trip: TripRecord = {
  id: "trip-1", ownerUserId: "owner-1", role: "owner", revision: 1,
  destinationName: "Penang", startDate: "2026-10-03", endDate: "2026-10-04",
  budgetTier: "standard", pace: "balanced", notes: "Markets", activeProposalId: null,
};

export function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "proposal-1", tripId: trip.id, status: "pending", model: "test-model",
    createdAt: "2026-09-03T00:00:00Z", expiresAt: "2099-10-04T00:00:00Z", tripRevision: 1,
    payload: {
      summary: "A morning in George Town", assumptions: ["Local transport available"],
      activities: [{ date: "2026-10-03", title: "Market visit", category: "food", startTime: "09:00",
        durationMinutes: 60, estimatedCostTier: "standard", rationale: "Time for local food",
        contingencyNote: "Covered market nearby" },
        { date: "2026-10-04", title: "Heritage museum", category: "culture", startTime: "10:00",
          durationMinutes: 90, estimatedCostTier: "standard", rationale: "Explore local history",
          contingencyNote: null }],
    }, ...overrides,
  };
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
