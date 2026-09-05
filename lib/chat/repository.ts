import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const chatAuthorKindSchema = z.enum(["member", "assistant", "system"]);
export type ChatAuthorKind = z.infer<typeof chatAuthorKindSchema>;

export type ChatMessage = {
  id: string;
  tripId: string;
  authorMemberId: string | null;
  authorKind: ChatAuthorKind;
  body: string;
  proposalId: string | null;
  createdAt: string;
};

const rowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  author_member_id: z.string().uuid().nullable(),
  author_kind: chatAuthorKindSchema,
  body: z.string(),
  proposal_id: z.string().uuid().nullable(),
  created_at: z.string(),
});

const COLUMNS = "id,trip_id,author_member_id,author_kind,body,proposal_id,created_at";

/** Shared row mapper so the Realtime channel and the REST fetch paths agree on shape. */
export function parseChatMessageRow(row: unknown): ChatMessage {
  const value = rowSchema.parse(row);
  return {
    id: value.id,
    tripId: value.trip_id,
    authorMemberId: value.author_member_id,
    authorKind: value.author_kind,
    body: value.body,
    proposalId: value.proposal_id,
    createdAt: value.created_at,
  };
}

/** The trip's most recent messages, oldest first, capped to a bounded window. */
export async function listMessages(client: SupabaseClient, tripId: string, limit = 100): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from("chat_messages")
    .select(COLUMNS)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(parseChatMessageRow).reverse();
}

/**
 * Backfill after a reconnect gap. Keyed on created_at, not id: ids are random UUIDs with no
 * chronological order, so only the timestamp can mean "newer than what we already have".
 */
export async function listMessagesSince(client: SupabaseClient, tripId: string, afterCreatedAt: string): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from("chat_messages")
    .select(COLUMNS)
    .eq("trip_id", tripId)
    .gt("created_at", afterCreatedAt)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(parseChatMessageRow);
}

/** A member sending a message as themselves. RLS rejects any other author_member_id. */
export async function sendMessage(client: SupabaseClient, tripId: string, authorMemberId: string, body: string): Promise<ChatMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message cannot be empty.");
  const { data, error } = await client
    .from("chat_messages")
    .insert({ trip_id: tripId, author_member_id: authorMemberId, author_kind: "member", body: trimmed })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return parseChatMessageRow(data);
}
