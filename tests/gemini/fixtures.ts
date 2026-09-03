import type { GeminiActivity, GeminiTripProposal, GeminiTripRequest } from "@/lib/gemini/types";

export const request: GeminiTripRequest = {
  destinationName: "George Town", startDate: "2026-10-03", endDate: "2026-10-04",
  budgetTier: "standard", pace: "balanced", notes: "Museums and food markets",
};
export const activity: GeminiActivity = {
  title: "Museum visit", category: "culture", date: "2026-10-03", startTime: "10:00",
  durationMinutes: 90, estimatedCostTier: "standard", rationale: "A cultural stop with a short visit.", contingencyNote: null,
};
export const proposal: GeminiTripProposal = {
  summary: "Two days of culture and food", activities: [activity, { ...activity, date: "2026-10-04" }],
  assumptions: ["Opening hours and prices need verification."],
};
