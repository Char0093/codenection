export const budgetTiers = [
  { value: "budget", label: "Budget" },
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "luxury", label: "Luxury" },
] as const;

export const paceLevels = [
  { value: "relaxed", label: "Relaxed" },
  { value: "balanced", label: "Balanced" },
  { value: "active", label: "Active" },
  { value: "intense", label: "Intense" },
] as const;

export type BudgetTier = (typeof budgetTiers)[number]["value"];
export type PaceLevel = (typeof paceLevels)[number]["value"];

export type TripSetupInput = {
  name: string;
  destinationName: string;
  startDate: string;
  endDate: string;
  budgetTier: BudgetTier;
  pace: PaceLevel;
  baseCurrency: string;
  notes?: string;
};

export function validateTripDates(startDate: string, endDate: string): string | null {
  return new Date(endDate) >= new Date(startDate) ? null : "The trip end date must be on or after the start date.";
}
