import { describe, expect, it } from "vitest";
import { GeminiProposalValidationError, validateGeminiProposal } from "@/lib/domain/gemini-proposal-validation";
import { activity, proposal, request } from "@/tests/gemini/fixtures";

describe("validateGeminiProposal", () => {
  it("provides validation errors that callers can map to 422", () => {
    try {
      validateGeminiProposal(request, { ...proposal, activities: [activity] }, "owner");
      expect.fail("Missing day must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiProposalValidationError);
      expect((error as GeminiProposalValidationError).errors).toEqual(["Missing activities for trip day 2026-10-04."]);
    }
  });
  it.each(["owner", "planner"] as const)("allows %s generation and returns parsed data", (role) => {
    const input = structuredClone(proposal);
    input.activities.reverse();
    const before = structuredClone(input);
    expect(validateGeminiProposal(request, input, role)).toEqual(before);
    expect(input).toEqual(before);
  });
  it.each(["member", "viewer", "stranger", undefined])("rejects unauthorized role %s", (role) => {
    expect(() => validateGeminiProposal(request, proposal, role)).toThrow(/owner or planner/);
  });
  it("rejects invalid trip dates before schedule validation", () => {
    expect(() => validateGeminiProposal({ ...request, startDate: "2026-02-30" }, proposal, "owner")).toThrow(/date|YYYY-MM-DD/);
  });
  it.each([
    [{ date: "2026-10-02" }, /outside.*trip/i], [{ date: "2026-10-05" }, /outside.*trip/i],
    [{ date: "2026-02-30" }, /date|YYYY-MM-DD/], [{ startTime: "25:00" }, /startTime|HH:mm/],
    [{ durationMinutes: 0 }, /durationMinutes|duration/], [{ startTime: "23:30", durationMinutes: 60 }, /midnight|day boundary/i],
    [{ estimatedCostTier: "premium" }, /budget/i],
  ] as const)("rejects an invalid activity %j", (patch, message) => {
    expect(() => validateGeminiProposal(request, { ...proposal, activities: [{ ...activity, ...patch }, proposal.activities[1]] }, "owner")).toThrow(message);
  });
  it("rejects missing days including the middle of the range", () => {
    expect(() => validateGeminiProposal({ ...request, endDate: "2026-10-05" }, {
      ...proposal, activities: [activity, { ...activity, date: "2026-10-05" }],
    }, "owner")).toThrow(/missing.*2026-10-04/i);
  });
  it("rejects overlapping activities even when input is unsorted", () => {
    expect(() => validateGeminiProposal(request, { ...proposal, activities: [
      { ...activity, startTime: "11:00" }, ...proposal.activities,
    ] }, "owner")).toThrow(/overlap/i);
  });
  it("allows adjacent activities and identical times on separate dates", () => {
    expect(validateGeminiProposal(request, { ...proposal, activities: [
      ...proposal.activities, { ...activity, startTime: "11:30", estimatedCostTier: "budget" },
    ] }, "owner").activities).toHaveLength(3);
  });
  it.each([["relaxed", 240], ["balanced", 360], ["active", 480], ["intense", 600]] as const)("enforces the %s total daily activity duration cap", (pace, cap) => {
    const oneDay = { ...request, endDate: request.startDate, pace };
    const makeProposal = (durationMinutes: number) => ({ ...proposal, activities: [
      { ...activity, startTime: "00:00", durationMinutes: cap / 2 },
      { ...activity, startTime: "12:00", durationMinutes },
    ] });
    expect(validateGeminiProposal(oneDay, makeProposal(cap / 2), "owner")).toBeDefined();
    expect(() => validateGeminiProposal(oneDay, makeProposal(cap / 2 + 1), "owner")).toThrow(/pace.*duration|duration.*pace/i);
  });
  it("accepts an activity ending exactly at midnight", () => {
    expect(validateGeminiProposal({ ...request, endDate: request.startDate }, {
      ...proposal, activities: [{ ...activity, startTime: "23:00", durationMinutes: 60 }],
    }, "owner")).toBeDefined();
  });
});
