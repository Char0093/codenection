import { tripInputSchema } from "@/lib/domain/trip";
import { budgetRank, paceDailyDurationCaps } from "@/lib/domain/itinerary";
import { geminiTripProposalSchema } from "@/lib/gemini/schemas";
import type { GeminiActivity, GeminiTripProposal } from "@/lib/gemini/types";

export class GeminiProposalValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "GeminiProposalValidationError";
    this.errors = [...errors];
  }
}

export function validateGeminiProposal(input: unknown, proposal: unknown, role: unknown): GeminiTripProposal {
  if (role !== "owner" && role !== "planner") {
    throw new GeminiProposalValidationError(["Only a trip owner or planner may generate a proposal."]);
  }
  const trip = tripInputSchema.parse(input);
  const parsed = geminiTripProposalSchema.parse(proposal);
  const days = new Map<string, GeminiActivity[]>();
  for (const activity of parsed.activities) {
    if (activity.date < trip.startDate || activity.date > trip.endDate) {
      throw new GeminiProposalValidationError([`Activity date ${activity.date} is outside the trip date range.`]);
    }
    if (budgetRank[activity.estimatedCostTier] > budgetRank[trip.budgetTier]) {
      throw new GeminiProposalValidationError([`Activity on ${activity.date} at ${activity.startTime} exceeds the trip budget tier.`]);
    }
    const dailyActivities = days.get(activity.date) ?? [];
    dailyActivities.push(activity);
    days.set(activity.date, dailyActivities);
  }
  for (let timestamp = Date.parse(trip.startDate); timestamp <= Date.parse(trip.endDate); timestamp += 86_400_000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const activities = days.get(date);
    if (!activities?.length) throw new GeminiProposalValidationError([`Missing activities for trip day ${date}.`]);
    activities.sort((left, right) => left.startTime.localeCompare(right.startTime));
    let previousEnd = 0;
    let totalDuration = 0;
    for (const activity of activities) {
      const [hours, minutes] = activity.startTime.split(":").map(Number);
      const start = hours * 60 + minutes;
      const end = start + activity.durationMinutes;
      if (end > 1440) throw new GeminiProposalValidationError([`Activity on ${date} at ${activity.startTime} crosses the midnight day boundary.`]);
      if (start < previousEnd) throw new GeminiProposalValidationError([`Activities overlap on ${date} at ${activity.startTime}.`]);
      previousEnd = end;
      totalDuration += activity.durationMinutes;
    }
    if (totalDuration > paceDailyDurationCaps[trip.pace]) {
      throw new GeminiProposalValidationError([`Daily activity duration on ${date} exceeds the ${trip.pace} pace duration cap of ${paceDailyDurationCaps[trip.pace]} minutes.`]);
    }
  }
  return parsed;
}
