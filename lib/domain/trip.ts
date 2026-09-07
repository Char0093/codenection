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

// --- Trip groups (spec 2026-09-06-first-login-travel-dna-chat-groups-design.md,
//     revised 2026-09-07) ---
//
// A "trip group" is just a `trips` row — there is no separate chat-groups model. After the
// safety-first pivot one organizer creates it with a minimum viable frame: destination,
// dates OR a duration, and a broad trip mode (proposed budget + split permission optional).
// The frame enables chat (`frameEnablesChat`); generation/scheduling still require a
// concrete valid date pair — `status = 'ready'`, re-checked in the DB, with `isTripReady`
// as the shared pure predicate.

export const tripGroupNameSchema = z
  .string()
  .trim()
  .min(1, "A group name is required.")
  .max(120)
  .refine(hasNoLikelySensitiveData, ordinaryTextMessage);

/** Broad trip intent chosen at creation. INVENTED vocabulary — the spec says only
 * "a broad trip mode". Keep in sync with the `public.trip_mode` enum in
 * supabase/migrations/202609060004_travel_dna_safety_baseline.sql. */
export const TRIP_MODES = ["relaxed", "balanced", "adventurous", "mixed"] as const;
export type TripMode = (typeof TRIP_MODES)[number];
export const tripModeSchema = z.enum(TRIP_MODES);
export const TRIP_MODE_LABELS: Readonly<Record<TripMode, string>> = {
  relaxed: "Relaxed",
  balanced: "Balanced",
  adventurous: "Adventurous",
  mixed: "A mix",
};

const durationDaysSchema = z.number().int().min(1).max(14);

const tripDestinationSchema = z
  .string()
  .trim()
  .min(1, "Destination is required.")
  .max(120)
  .refine(hasNoLikelySensitiveData, ordinaryTextMessage);

/** Organizer trip frame (spec §2.3 / §3.3). Either an explicit `startDate`+`endDate` pair
 * (≤14 days, the path that can reach `status = 'ready'`) OR a `plannedDurationDays`
 * integer (1–14). A duration-only frame enables chat but stays `draft` until real dates. */
export const createTripFrameSchema = z.strictObject({
  name: tripGroupNameSchema,
  destinationName: tripDestinationSchema,
  tripMode: tripModeSchema,
  startDate: calendarDateSchema.optional(),
  endDate: calendarDateSchema.optional(),
  plannedDurationDays: durationDaysSchema.optional(),
  proposedBudgetTier: budgetTierSchema.nullable().default(null),
  splitAllowed: z.boolean().default(false),
}).superRefine((input, ctx) => {
  const hasPair = input.startDate != null && input.endDate != null;
  const hasDuration = input.plannedDurationDays != null;
  if (!hasPair && !hasDuration) {
    ctx.addIssue({ code: "custom", path: ["startDate"], message: "Provide trip dates or a duration." });
  }
  if ((input.startDate == null) !== (input.endDate == null)) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Provide both a start and an end date, or neither." });
  }
  if (hasPair) {
    const error = validateTripDates(input.startDate!, input.endDate!);
    if (error) ctx.addIssue({ code: "custom", path: ["endDate"], message: error });
  }
});
export type CreateTripFrameInput = z.infer<typeof createTripFrameSchema>;

/** True once the group has enough of a frame to open chat (spec §2.3). Weaker than
 * `isTripReady`, which additionally requires a concrete valid date pair for generation. */
export function frameEnablesChat(fields: {
  destinationName: string | null;
  tripMode: TripMode | string | null;
  startDate: string | null;
  endDate: string | null;
  plannedDurationDays: number | null;
}): boolean {
  if (!fields.destinationName || !fields.destinationName.trim()) return false;
  if (!fields.tripMode || !tripModeSchema.safeParse(fields.tripMode).success) return false;
  const hasPair = !!fields.startDate && !!fields.endDate;
  return hasPair || (fields.plannedDurationDays != null && fields.plannedDurationDays >= 1);
}

export const tripStatusSchema = z.enum(["draft", "ready"]);
export type TripStatus = z.infer<typeof tripStatusSchema>;

export function isTripReady(fields: {
  destinationName: string | null;
  startDate: string | null;
  endDate: string | null;
}): boolean {
  const { destinationName, startDate, endDate } = fields;
  if (!destinationName || !destinationName.trim()) return false;
  if (!startDate || !endDate) return false;
  return validateTripDates(startDate, endDate) === null;
}
