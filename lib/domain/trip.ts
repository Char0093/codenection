import { z } from "zod";

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

export const budgetTierSchema = z.enum(budgetTiers.map((tier) => tier.value));
export const paceLevelSchema = z.enum(paceLevels.map((pace) => pace.value));

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.").refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Date must be a calendar-valid YYYY-MM-DD.");

export function validateTripDates(startDate: string, endDate: string): string | null {
  if (!calendarDateSchema.safeParse(startDate).success || !calendarDateSchema.safeParse(endDate).success) {
    return "Trip dates must be calendar-valid YYYY-MM-DD.";
  }
  if (endDate < startDate) return "The trip end date must be on or after the start date.";
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  return days > 14 ? "Trips must be between 1 and 14 days inclusive." : null;
}

// A conservative English-language guard for common disclosures, not a comprehensive
// sensitive-data classifier. Keep all free-text trip fields subject to this check.
const sensitivePatterns = [
  /\b(celiac|coeliac|bipolar|schizophren\w*|dementia|arthritis|parkinson\w*|multiple\s+sclerosis|lactose\s+intoleran\w*)\b/i,
  /\b(limited|reduced|impaired)\s+mobility\b/i,
  /\b[a-z]+\s*:\s*(muslim|christian|jewish|hindu|buddhist|sikh|catholic|protestant|atheist|jain)\b/i,
  /\b(follow|follows|practi[sc]e|practi[sc]es|convert(?:ed)?\s+to)\s+(islam|christianity|judaism|hinduism|buddhism|sikhism|jainism)\b/i,
  /\b(group|members?|travell?ers?)\b[^.!?\n]{0,60}\b(muslims?|christians?|jews?|hindus?|buddhists?|sikhs?|catholics?|jains?)\b/i,
  /\b(medical|medication|prescription|diagnos\w*|diabet\w*|asthma|epilep\w*|seizures?|cancer|chemotherapy|insulin|pregnan\w*|chronic\s+pain|heart\s+condition|mental\s+health|depression|anxiety\s+disorder|ptsd|hiv)\b/i,
  /\b(disabilit\w*|disabled|wheel\s*chair\w*|mobility\s+(aid|impairment|condition)|autis\w*|adhd|deaf|blind|hearing\s+(loss|impair\w*)|visually\s+impaired|sensory\s+sensitiv\w*)\b/i,
  /\b(allerg\w*|anaphyla\w*|epipen)\b/i,
  /\b(religion|religious\s+(identity|profile|requirement|belief))\b/i,
  /\b(i|we|he|she|they|[a-z]+)\s+(?:am|is|are|was|practi[sc]es?|identif(?:y|ies)\s+as)\s+(?:(?:a|an|devout|practicing)\s+)*(muslim|christian|jewish|jew|hindu|buddhist|sikh|catholic|protestant|atheist|jain)\b/i,
  /\b(my|our|his|her|their)\s+(muslim|christian|jewish|hindu|buddhist|sikh|catholic|jain)\b/i,
];

function hasNoLikelySensitiveData(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return !sensitivePatterns.some((pattern) => pattern.test(normalized));
}

const ordinaryTextMessage = "Remove sensitive personal information; use ordinary trip preferences only.";

export const tripInputSchema = z.strictObject({
  destinationName: z.string().trim().min(1, "Destination is required.").max(120)
    .refine(hasNoLikelySensitiveData, ordinaryTextMessage),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  budgetTier: budgetTierSchema,
  pace: paceLevelSchema,
  notes: z.string().trim().max(1000).refine(hasNoLikelySensitiveData, ordinaryTextMessage).optional(),
}).superRefine((input, context) => {
  const error = validateTripDates(input.startDate, input.endDate);
  if (error) context.addIssue({ code: "custom", path: ["endDate"], message: error });
});

export type TripInput = z.infer<typeof tripInputSchema>;
