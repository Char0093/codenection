import { z } from "zod";
import { budgetTierSchema, calendarDateSchema, tripInputSchema } from "@/lib/domain/trip";

export const geminiTripRequestSchema = tripInputSchema;

export const geminiActivitySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  category: z.enum(["culture", "food", "nature", "shopping", "transit"]),
  date: calendarDateSchema,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must be HH:mm (00:00-23:59)."),
  durationMinutes: z.number().int().min(15).max(480),
  estimatedCostTier: budgetTierSchema,
  rationale: z.string().trim().min(1).max(1000),
  contingencyNote: z.string().trim().min(1).max(1000).nullable(),
});

export const geminiTripProposalSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2000),
  activities: z.array(geminiActivitySchema).min(1).max(336),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(30),
});
