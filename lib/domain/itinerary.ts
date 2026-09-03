import type { BudgetTier, PaceLevel } from "@/lib/domain/trip";

export type ActivityCandidate = {
  id: string;
  title: string;
  category: "culture" | "food" | "nature" | "shopping" | "transit";
  date: string;
  startTime: string;
  durationMinutes: number;
  costTier: BudgetTier;
  rationale: string;
  contingencyNote: string | null;
};

export type PlanningContext = {
  budgetTier: BudgetTier;
  pace: PaceLevel;
};

export type CandidateEvaluation = {
  eligible: boolean;
  score: number;
  reasons: string[];
  blockers: string[];
};

export type EvaluatedCandidate = CandidateEvaluation & { candidate: ActivityCandidate };

export type ItineraryProposal = {
  id: string;
  status: "pending";
  createdAt: string;
  items: EvaluatedCandidate[];
  conflicts: EvaluatedCandidate[];
};

export const budgetRank: Readonly<Record<BudgetTier, number>> = {
  budget: 0, standard: 1, premium: 2, luxury: 3,
};

// Caps measure summed activity minutes per calendar day; gaps do not consume them.
export const paceDailyDurationCaps: Readonly<Record<PaceLevel, number>> = {
  relaxed: 240, balanced: 360, active: 480, intense: 600,
};

export function evaluateCandidate(candidate: ActivityCandidate, context: PlanningContext): CandidateEvaluation {
  const blockers: string[] = [];
  if (budgetRank[candidate.costTier] > budgetRank[context.budgetTier]) {
    blockers.push("Activity cost exceeds the trip budget tier.");
  }
  if (candidate.durationMinutes > paceDailyDurationCaps[context.pace]) {
    blockers.push("Activity duration exceeds the daily pace duration cap.");
  }
  if (blockers.length) return { eligible: false, score: 0, reasons: [], blockers };
  const budgetDifference = budgetRank[context.budgetTier] - budgetRank[candidate.costTier];
  return {
    eligible: true,
    score: 100 - budgetDifference * 12,
    reasons: [budgetDifference === 0 ? "Matches group budget" : "Below the group budget tier", "Fits the group pace"],
    blockers,
  };
}

// Ranking is for comparing candidates, not approving a schedule. Full proposals
// must pass validateGeminiProposal before persistence or confirmation.
export function generateItineraryProposal(candidates: ActivityCandidate[], context: PlanningContext): ItineraryProposal {
  const evaluated = candidates.map((candidate) => ({ candidate, ...evaluateCandidate(candidate, context) }));
  return {
    id: `proposal-${candidates.map((candidate) => candidate.id).join("-")}`,
    status: "pending",
    createdAt: new Date().toISOString(),
    items: evaluated.filter((result) => result.eligible).sort((left, right) =>
      right.score - left.score || left.candidate.date.localeCompare(right.candidate.date)
      || left.candidate.startTime.localeCompare(right.candidate.startTime)),
    conflicts: evaluated.filter((result) => !result.eligible),
  };
}
