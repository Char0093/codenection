import { describe, expect, it } from "vitest";
import { validateGeminiProposal } from "@/lib/domain/gemini-proposal-validation";
import { mockPlanTrip } from "@/lib/mock/repository";

const input = {
  destinationName: "George Town, Penang",
  startDate: "2026-10-03",
  endDate: "2026-10-05",
  budgetTier: "standard",
  pace: "balanced",
} as const;

describe("mock trip planner", () => {
  it("returns validator-compatible activities for every trip day", async () => {
    const { proposal, model } = await mockPlanTrip(input);
    expect(model).toBe("mock-gemini");
    expect(proposal.activities.map((activity) => activity.date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(validateGeminiProposal(input, proposal, "planner")).toEqual(proposal);
  });
});
