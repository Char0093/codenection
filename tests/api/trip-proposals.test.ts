import { describe, expect, it, vi } from "vitest";
import { generateProposal } from "@/lib/services/trip-proposals";
import type { TripRecord, TripRepository, ProposalRecord } from "@/lib/repositories/planning-repository";

const trip: TripRecord = { id: "12345678-1234-4123-8123-123456789012", ownerUserId: "owner", role: "owner", revision: 1, activeProposalId: "approved", destinationName: "Penang", startDate: "2026-10-03", endDate: "2026-10-03", budgetTier: "standard", pace: "balanced", notes: "Art museums" };
const payload = { summary: "Art afternoon", activities: [{ date: "2026-10-03", title: "Gallery", category: "culture" as const, startTime: "14:00", durationMinutes: 60, estimatedCostTier: "standard" as const, rationale: "Matches art interests", contingencyNote: null }], assumptions: ["Check opening times before visiting."] };

function repository(overrides: Partial<TripRecord> = {}) {
  const persisted: ProposalRecord[] = [];
  const repo = {
    getTrip: async () => ({ ...trip, ...overrides }),
    reserveGeneration: vi.fn(async () => {}),
    listConfirmedConstraints: async () => [],
    listTravelerCaps: async () => [],
    saveProposal: async (_trip: TripRecord, value: typeof payload, model: string) => {
      const record = { id: "proposal", tripId: trip.id, status: "pending" as const, payload: value, model, tripRevision: 1, createdAt: "2026-09-03T00:00:00Z", expiresAt: "2026-09-04T00:00:00Z" };
      persisted.push(record);
      return record;
    },
  };
  return { repo: repo as unknown as TripRepository, persisted };
}

describe("proposal generation service", () => {
  it("sends only trip input and persists a pending proposal without activation", async () => {
    const { repo, persisted } = repository();
    let received: unknown;
    const result = await generateProposal(trip.id, repo, async (input) => { received = input; return { proposal: payload, model: "test-model" }; });
    expect(received).toEqual({ destinationName: "Penang", startDate: trip.startDate, endDate: trip.endDate, budgetTier: "standard", pace: "balanced", notes: "Art museums" });
    expect(result.status).toBe("pending");
    expect(persisted).toHaveLength(1);
    expect((await repo.getTrip(trip.id)).activeProposalId).toBe("approved");
  });
  it.each(["member", "viewer"] as const)("does not call Gemini for a %s", async (role) => {
    const { repo, persisted } = repository({ role });
    const provider = vi.fn();
    await expect(generateProposal(trip.id, repo, provider)).rejects.toMatchObject({ status: 403 });
    expect(provider).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });
  it("does not call Gemini when the distributed limit is exceeded", async () => {
    const { repo } = repository();
    repo.reserveGeneration = async () => { throw new Error("limit"); };
    const provider = vi.fn();
    await expect(generateProposal(trip.id, repo, provider)).rejects.toThrow("limit");
    expect(provider).not.toHaveBeenCalled();
  });
  it("preserves approved state after provider failure", async () => {
    const { repo, persisted } = repository();
    await expect(generateProposal(trip.id, repo, async () => { throw new Error("provider down"); })).rejects.toThrow();
    expect(persisted).toHaveLength(0);
    expect((await repo.getTrip(trip.id)).activeProposalId).toBe("approved");
  });
  it("rejects invalid schedules without persisting them", async () => {
    const { repo, persisted } = repository();
    await expect(generateProposal(trip.id, repo, async () => ({ proposal: { ...payload, activities: [{ ...payload.activities[0], date: "2026-10-04" }] }, model: "fake" }))).rejects.toThrow();
    expect(persisted).toHaveLength(0);
  });
  it("uses the original revision when saving, allowing DB to reject concurrent trip edits", async () => {
    const { repo } = repository();
    let revision: number | undefined;
    repo.saveProposal = async (snapshot) => { revision = snapshot.revision; throw new Error("stale"); };
    await expect(generateProposal(trip.id, repo, async () => ({ proposal: payload, model: "fake" }))).rejects.toThrow("stale");
    expect(revision).toBe(1);
  });
});
