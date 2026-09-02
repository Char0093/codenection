import { describe, expect, it } from "vitest";
import {
  evaluateCandidate,
  generateItineraryProposal,
  type ActivityCandidate,
  type MemberPlanningProfile,
  type PlanningContext,
} from "@/lib/domain/itinerary";
import { confirmProposal } from "@/lib/domain/proposal";

const candidate: ActivityCandidate = {
  id: "museum",
  title: "Pinang Peranakan Mansion",
  category: "culture",
  allergens: [],
  accessibilityFeatures: ["step_free"],
  dietaryOptions: [],
  halalStatus: "not_applicable",
  indoor: true,
  costTier: "standard",
  intensity: "relaxed",
  travelMinutes: 12,
  isOpen: true,
  startTime: "10:00",
  durationMinutes: 90,
};

const member: MemberPlanningProfile = {
  id: "member-1",
  displayName: "Aisha",
  consentStatus: "granted",
  severeAllergies: [],
  accessibilityRequirements: [],
  dietaryRequirements: [],
  requiresHalal: false,
};

const context: PlanningContext = {
  budgetTier: "standard",
  pace: "balanced",
  weather: "rain",
  members: [member],
};

describe("evaluateCandidate", () => {
  it("blocks planning while a member's consent is unresolved", () => {
    const result = evaluateCandidate(candidate, {
      ...context,
      members: [{ ...member, consentStatus: "pending" }],
    });

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("Aisha has not consented to profile-based planning.");
  });

  it("hard-blocks a severe allergy conflict", () => {
    const result = evaluateCandidate(
      { ...candidate, allergens: ["peanuts"] },
      { ...context, members: [{ ...member, severeAllergies: ["Peanuts"] }] },
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers[0]).toContain("severe allergy");
  });

  it("hard-blocks an unmet accessibility requirement", () => {
    const result = evaluateCandidate(candidate, {
      ...context,
      members: [{ ...member, accessibilityRequirements: ["wheelchair_accessible_toilet"] }],
    });

    expect(result.eligible).toBe(false);
    expect(result.blockers[0]).toContain("wheelchair accessible toilet");
  });

  it("explains safety and weather scoring decisions", () => {
    const result = evaluateCandidate(candidate, context);

    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("Indoors during forecast rain");
    expect(result.reasons).toContain("Low travel time");
  });

  it("blocks a closed candidate", () => {
    const result = evaluateCandidate({ ...candidate, isOpen: false }, context);

    expect(result.eligible).toBe(false);
    expect(result.blockers[0]).toContain("closed");
  });

  it("rewards verified halal food when required", () => {
    const result = evaluateCandidate(
      { ...candidate, category: "food", halalStatus: "verified" },
      { ...context, weather: "clear", members: [{ ...member, requiresHalal: true }] },
    );

    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("Halal verified");
  });

  it("penalizes long outdoor options with a poor budget and pace fit", () => {
    const result = evaluateCandidate(
      { ...candidate, indoor: false, costTier: "luxury", intensity: "intense", travelMinutes: 50 },
      context,
    );

    expect(result.eligible).toBe(true);
    expect(result.score).toBeLessThan(50);
    expect(result.reasons).toContain("Outdoor option has rain exposure");
    expect(result.reasons).toContain("Requires a pace adjustment");
  });
});

describe("generateItineraryProposal", () => {
  it("ranks eligible candidates and retains rejected conflicts for review", () => {
    const proposal = generateItineraryProposal(
      [
        candidate,
        { ...candidate, id: "hawker", title: "Peanut Market", allergens: ["peanuts"] },
        { ...candidate, id: "park", title: "Botanical Gardens", indoor: false, travelMinutes: 35 },
      ],
      { ...context, members: [{ ...member, severeAllergies: ["peanuts"] }] },
    );

    expect(proposal.status).toBe("pending");
    expect(proposal.items[0].candidate.id).toBe("museum");
    expect(proposal.conflicts).toHaveLength(1);
    expect(proposal.conflicts[0].candidate.id).toBe("hawker");
  });
});

describe("confirmProposal", () => {
  it("allows an owner to activate a pending proposal", () => {
    expect(confirmProposal("pending", "owner")).toBe("accepted");
  });

  it("does not allow a regular member to activate a proposal", () => {
    expect(() => confirmProposal("pending", "member")).toThrow("owner or planner");
  });

  it("does not reconfirm a proposal that already has a decision", () => {
    expect(() => confirmProposal("accepted", "owner")).toThrow("pending proposals");
  });
});
