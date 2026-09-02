import type { BudgetTier, PaceLevel } from "@/lib/domain/trip";

export type ConsentStatus = "pending" | "granted" | "revoked";
export type WeatherCondition = "clear" | "rain" | "heat";

export type MemberPlanningProfile = {
  id: string;
  displayName: string;
  consentStatus: ConsentStatus;
  severeAllergies: string[];
  accessibilityRequirements: string[];
  dietaryRequirements: string[];
  requiresHalal: boolean;
};

export type ActivityCandidate = {
  id: string;
  title: string;
  category: "culture" | "food" | "nature" | "shopping" | "transit";
  allergens: string[];
  accessibilityFeatures: string[];
  dietaryOptions: string[];
  halalStatus: "verified" | "not_verified" | "not_applicable";
  indoor: boolean;
  costTier: BudgetTier;
  intensity: PaceLevel;
  travelMinutes: number;
  isOpen: boolean;
  startTime: string;
  durationMinutes: number;
};

export type PlanningContext = {
  budgetTier: BudgetTier;
  pace: PaceLevel;
  weather: WeatherCondition;
  members: MemberPlanningProfile[];
};

export type CandidateEvaluation = {
  eligible: boolean;
  score: number;
  reasons: string[];
  blockers: string[];
};

export type EvaluatedCandidate = CandidateEvaluation & {
  candidate: ActivityCandidate;
};

export type ItineraryProposal = {
  id: string;
  status: "pending";
  createdAt: string;
  items: EvaluatedCandidate[];
  conflicts: EvaluatedCandidate[];
};

const budgetRank: Record<BudgetTier, number> = {
  budget: 0,
  standard: 1,
  premium: 2,
  luxury: 3,
};

const paceRank: Record<PaceLevel, number> = {
  relaxed: 0,
  balanced: 1,
  active: 2,
  intense: 3,
};

function normalized(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase());
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

export function evaluateCandidate(
  candidate: ActivityCandidate,
  context: PlanningContext,
): CandidateEvaluation {
  const blockers: string[] = [];
  const reasons: string[] = [];
  let score = 100;

  for (const member of context.members) {
    if (member.consentStatus !== "granted") {
      blockers.push(`${member.displayName} has not consented to profile-based planning.`);
      continue;
    }

    const candidateAllergens = normalized(candidate.allergens);
    const allergy = normalized(member.severeAllergies).find((item) => candidateAllergens.includes(item));
    if (allergy) {
      blockers.push(`${candidate.title} conflicts with ${member.displayName}'s severe allergy: ${readable(allergy)}.`);
    }

    const features = normalized(candidate.accessibilityFeatures);
    const missingAccess = normalized(member.accessibilityRequirements).find((item) => !features.includes(item));
    if (missingAccess) {
      blockers.push(`${candidate.title} does not confirm ${readable(missingAccess)} for ${member.displayName}.`);
    }

    if (candidate.category === "food" && member.requiresHalal && candidate.halalStatus !== "verified") {
      blockers.push(`${candidate.title} is not halal verified for ${member.displayName}.`);
    }
  }

  if (!candidate.isOpen) {
    blockers.push(`${candidate.title} is closed at the proposed time.`);
  }

  if (blockers.length > 0) {
    return { eligible: false, score: 0, reasons, blockers };
  }

  const budgetDifference = Math.abs(budgetRank[candidate.costTier] - budgetRank[context.budgetTier]);
  score -= budgetDifference * 12;
  reasons.push(budgetDifference === 0 ? "Matches group budget" : "Near the group budget range");

  const paceDifference = Math.abs(paceRank[candidate.intensity] - paceRank[context.pace]);
  score -= paceDifference * 8;
  reasons.push(paceDifference <= 1 ? "Fits the group pace" : "Requires a pace adjustment");

  if (candidate.travelMinutes <= 20) {
    score += 8;
    reasons.push("Low travel time");
  } else {
    score -= Math.min(20, candidate.travelMinutes - 20);
  }

  if (context.weather === "rain") {
    if (candidate.indoor) {
      score += 10;
      reasons.push("Indoors during forecast rain");
    } else {
      score -= 20;
      reasons.push("Outdoor option has rain exposure");
    }
  }

  if (candidate.category === "food" && candidate.halalStatus === "verified") {
    reasons.push("Halal verified");
  }

  return { eligible: true, score: Math.max(0, score), reasons, blockers };
}

export function generateItineraryProposal(
  candidates: ActivityCandidate[],
  context: PlanningContext,
): ItineraryProposal {
  const evaluated = candidates.map((candidate) => ({
    candidate,
    ...evaluateCandidate(candidate, context),
  }));

  return {
    id: `proposal-${candidates.map((candidate) => candidate.id).join("-")}`,
    status: "pending",
    createdAt: new Date().toISOString(),
    items: evaluated
      .filter((result) => result.eligible)
      .sort((left, right) => right.score - left.score || left.candidate.startTime.localeCompare(right.candidate.startTime)),
    conflicts: evaluated.filter((result) => !result.eligible),
  };
}
