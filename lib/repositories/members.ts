import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type TripMemberSummary = { id: string; displayName: string; userId: string | null };

const rowSchema = z.object({ id: z.string().uuid(), display_name: z.string(), user_id: z.string().uuid().nullable() });

/** A palette distinct from the app's navy/gold accent -- member colors are identity, not brand. */
const PALETTE = ["#182544", "#a6432e", "#3f7d52", "#7d5ba6", "#c1861f", "#3f6f8a"];

export async function listTripMembers(client: SupabaseClient, tripId: string): Promise<TripMemberSummary[]> {
  const { data, error } = await client.from("trip_members").select("id,display_name,user_id").eq("trip_id", tripId).order("joined_at");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const value = rowSchema.parse(row);
    return { id: value.id, displayName: value.display_name, userId: value.user_id };
  });
}

export function colorForMemberIndex(index: number): string {
  return PALETTE[index % PALETTE.length];
}
