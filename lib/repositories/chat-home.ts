import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifiedUser } from "@/lib/supabase/auth";
import { databaseError } from "@/lib/http/errors";
import { colorForMemberIndex } from "@/lib/repositories/members";
import {
  chatHomeSchema, toLatestMessagePreview, CHAT_HOME_MAX_AVATARS, type ChatHome,
} from "@/lib/domain/chat-home";

const avatarRowSchema = z.object({ id: z.string().uuid(), displayName: z.string().min(1) });

const rpcRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(["draft", "ready"]),
  destination_name: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  trip_mode: z.string().nullable(),
  planned_duration_days: z.number().int().nullable(),
  proposed_budget_tier: z.string().nullable(),
  member_count: z.coerce.number().int(),
  member_avatars: z.array(avatarRowSchema),
  latest_message_body: z.string().nullable(),
  latest_message_at: z.string().nullable(),
});

/** The caller's chat-group home (spec §2.3 / §5). One `chatHomeTripSchema` row per trip
 *  they belong to, ordered by recent activity, with bounded metadata only. */
export async function getChatHome(client: SupabaseClient): Promise<ChatHome> {
  await verifiedUser(client);
  const { data, error } = await client.rpc("chat_home");
  if (error) databaseError(error);

  const trips = ((data ?? []) as unknown[]).map((raw) => {
    const row = rpcRowSchema.parse(raw);
    const preview = row.latest_message_body ? toLatestMessagePreview(row.latest_message_body) : null;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      destinationName: row.destination_name,
      startDate: row.start_date,
      endDate: row.end_date,
      tripMode: row.trip_mode,
      plannedDurationDays: row.planned_duration_days,
      proposedBudgetTier: row.proposed_budget_tier,
      memberCount: row.member_count,
      latestMessage: preview && row.latest_message_at
        ? { preview, at: new Date(row.latest_message_at).toISOString() }
        : null,
      memberAvatars: row.member_avatars
        .slice(0, CHAT_HOME_MAX_AVATARS)
        .map((avatar, index) => ({ ...avatar, color: colorForMemberIndex(index) })),
      unread: null,
    };
  });

  return chatHomeSchema.parse({ trips });
}
