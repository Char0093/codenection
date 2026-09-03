import { describe, expect, it } from "vitest";
import { evaluateCandidate, generateItineraryProposal, type ActivityCandidate } from "@/lib/domain/itinerary";
import { confirmProposal } from "@/lib/domain/proposal";

const candidate: ActivityCandidate = {
  id: "museum", title: "Museum visit", category: "culture", date: "2026-10-03",
  costTier: "standard", startTime: "10:00", durationMinutes: 90,
  rationale: "A cultural stop", contingencyNote: null,
};
const context = { budgetTier: "standard", pace: "balanced" } as const;

describe("trip-level candidate evaluation", () => {
  it("scores ordinary budget and duration fit", () => {
    const result = evaluateCandidate(candidate, context);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("Matches group budget");
    expect(result.reasons).toContain("Fits the group pace");
  });
  it("blocks activities above budget or the daily pace cap", () => {
    expect(evaluateCandidate({ ...candidate, costTier: "luxury" }, context).eligible).toBe(false);
    expect(evaluateCandidate({ ...candidate, durationMinutes: 360 }, context).eligible).toBe(true);
    expect(evaluateCandidate({ ...candidate, durationMinutes: 361 }, context).eligible).toBe(false);
  });
  it("retains rejected candidates and ranks eligible candidates", () => {
    const result = generateItineraryProposal([
      { ...candidate, id: "value", costTier: "budget" },
      candidate, { ...candidate, id: "expensive", costTier: "luxury" },
    ], context);
    expect(result.status).toBe("pending");
    expect(result.items[0].candidate.id).toBe("museum");
    expect(result.conflicts.map((item) => item.candidate.id)).toEqual(["expensive"]);
  });
});

describe("confirmProposal", () => {
  it("allows an owner to activate a pending proposal", () => {
    expect(confirmProposal("pending", "owner")).toBe("accepted");
  });
  it.each(["planner", "member", "viewer"] as const)("rejects %s confirmation", (role) => {
    expect(() => confirmProposal("pending", role)).toThrow("Only a trip owner");
  });
  it.each(["accepted", "rejected"] as const)("rejects a decided proposal: %s", (status) => {
    expect(() => confirmProposal(status, "owner")).toThrow("pending proposals");
  });
});
