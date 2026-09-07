import { z } from "zod";
import { calendarDateSchema, tripStatusSchema, tripModeSchema, budgetTierSchema } from "@/lib/domain/trip";

/**
 * Contract for the chat-group home (`GET /api/chats`, spec §2.3 / §5). Each row is one
 * trip the caller is a member of, carrying only bounded, cheap-to-compute metadata — never
 * a full message body or an unbounded avatar list.
 */

export const LATEST_MESSAGE_PREVIEW_MAX = 140;
export const CHAT_HOME_MAX_AVATARS = 8;

/**
 * Collapse whitespace and hard-cap length so a list row can never render a whole message
 * or a multi-line blob. Returns `null` for an empty or whitespace-only body.
 */
export function toLatestMessagePreview(body: string): string | null {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > LATEST_MESSAGE_PREVIEW_MAX
    ? collapsed.slice(0, LATEST_MESSAGE_PREVIEW_MAX - 1).trimEnd() + "…"
    : collapsed;
}

const avatarSchema = z.strictObject({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  color: z.string().min(1),
});

export const chatHomeTripSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: tripStatusSchema,
  destinationName: z.string().nullable(),
  startDate: calendarDateSchema.nullable(),
  endDate: calendarDateSchema.nullable(),
  // Organizer frame (spec §2.3 / §2.4) — shown in the list row and the future invite preview.
  tripMode: tripModeSchema.nullable(),
  plannedDurationDays: z.number().int().min(1).max(14).nullable(),
  proposedBudgetTier: budgetTierSchema.nullable(),
  memberCount: z.number().int().min(1),
  latestMessage: z
    .strictObject({
      preview: z.string().min(1).max(LATEST_MESSAGE_PREVIEW_MAX),
      at: z.string().datetime(),
    })
    .nullable(),
  memberAvatars: z.array(avatarSchema).max(CHAT_HOME_MAX_AVATARS),
  /** `null` until unread infrastructure exists (spec §2.3, §8). */
  unread: z.number().int().min(0).nullable(),
});
export type ChatHomeTrip = z.infer<typeof chatHomeTripSchema>;

export const chatHomeSchema = z.strictObject({ trips: z.array(chatHomeTripSchema) });
export type ChatHome = z.infer<typeof chatHomeSchema>;
