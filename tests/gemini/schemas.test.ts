import { describe, expect, it } from "vitest";
import { geminiTripProposalSchema, geminiTripRequestSchema } from "@/lib/gemini/schemas";
import { mapProposalToCandidates } from "@/lib/gemini/mapper";
import { activity, proposal, request } from "./fixtures";

describe("Gemini schemas", () => {
  it("accepts the trip contract and dated proposal", () => {
    expect(geminiTripRequestSchema.parse(request)).toEqual(request);
    expect(geminiTripProposalSchema.parse(proposal)).toEqual(proposal);
  });
  it("uses the privacy and strict input rules for provider requests", () => {
    expect(geminiTripRequestSchema.safeParse({ ...request, notes: "I have diabetes" }).success).toBe(false);
    expect(geminiTripRequestSchema.safeParse({ ...request, members: [] }).success).toBe(false);
  });
  it.each([
    { startTime: "24:00" }, { startTime: "09:60" }, { startTime: "9:30" }, { startTime: "09:30Z" },
    { date: "2026-02-29" }, { date: undefined }, { category: "booking" }, { estimatedCostTier: "cheap" },
    { rationale: undefined }, { rationale: " " }, { durationMinutes: 0 }, { durationMinutes: -1 },
    { durationMinutes: 1.5 }, { durationMinutes: 14 }, { durationMinutes: 481 },
    { durationMinutes: 1441 }, { title: " " }, { contingencyNote: undefined },
    { allergens: [] },
  ])("rejects malformed activity %j", (patch) => {
    expect(geminiTripProposalSchema.safeParse({ ...proposal, activities: [{ ...activity, ...patch }] }).success).toBe(false);
  });
  it.each([{ activities: [] }, { summary: " " }, { assumptions: [""] }, { activate: true }])("rejects malformed proposal %j", (patch) => {
    expect(geminiTripProposalSchema.safeParse({ ...proposal, ...patch }).success).toBe(false);
  });
  it.each([15, 480])("accepts the inclusive activity duration boundary %i", (durationMinutes) => {
    expect(geminiTripProposalSchema.safeParse({ ...proposal, activities: [{ ...activity, durationMinutes }] }).success).toBe(true);
  });
});

describe("mapProposalToCandidates", () => {
  it("preserves dated suggestions without inventing profile or factual fields", () => {
    const original = structuredClone(proposal);
    const candidates = mapProposalToCandidates(proposal);
    expect(candidates[0]).toEqual({
      id: "gemini-2026-10-03-1", title: activity.title, category: activity.category,
      date: activity.date, startTime: activity.startTime, durationMinutes: activity.durationMinutes,
      costTier: activity.estimatedCostTier, rationale: activity.rationale, contingencyNote: null,
    });
    expect(new Set(candidates.map((item) => item.id)).size).toBe(2);
    candidates[0].title = "Changed";
    expect(proposal).toEqual(original);
  });
});
