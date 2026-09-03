import type { ActivityCandidate } from "@/lib/domain/itinerary";
import type { GeminiTripProposal } from "./types";

export function mapProposalToCandidates(proposal: GeminiTripProposal): ActivityCandidate[] {
  return proposal.activities.map((activity, index) => ({
    id: `gemini-${activity.date}-${index + 1}`,
    title: activity.title,
    category: activity.category,
    date: activity.date,
    startTime: activity.startTime,
    durationMinutes: activity.durationMinutes,
    costTier: activity.estimatedCostTier,
    rationale: activity.rationale,
    contingencyNote: activity.contingencyNote,
  }));
}
