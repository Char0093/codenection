// The invitation preview an invitee sees BEFORE joining a trip (spec §2.4). It carries
// only the organizer's frame plus a member count — never a member's private budget,
// health detail, or veto attribution. Invitation delivery itself stays deferred (§8);
// this contract fixes the boundary now.
import { z } from "zod";
import { budgetTierSchema, paceLevelSchema, calendarDateSchema } from "@/lib/domain/trip";

export const tripPreviewSchema = z.strictObject({
  organizerName: z.string().min(1),
  destinationName: z.string().nullable(),
  startDate: calendarDateSchema.nullable(),
  endDate: calendarDateSchema.nullable(),
  plannedDurationDays: z.number().int().min(1).max(14).nullable(),
  memberCount: z.number().int().min(1),
  proposedBudgetTier: budgetTierSchema.nullable(),
  pace: paceLevelSchema.nullable(),
});
export type TripPreview = z.infer<typeof tripPreviewSchema>;
