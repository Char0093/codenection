import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { databaseError } from "@/lib/http/errors";

export type ActiveItineraryItem = {
  id: string;
  dayId: string;
  title: string;
  category: string;
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  sortOrder: number;
};

const rowSchema = z.object({
  id: z.string().uuid(),
  itinerary_day_id: z.string().uuid(),
  title: z.string(),
  item_type: z.string(),
  local_date: z.string(),
  local_start_time: z.string(),
  local_end_time: z.string(),
  sort_order: z.number().int(),
});

function mapRow(row: unknown): ActiveItineraryItem {
  const value = rowSchema.parse(row);
  return {
    id: value.id, dayId: value.itinerary_day_id, title: value.title, category: value.item_type,
    localDate: value.local_date, localStartTime: value.local_start_time, localEndTime: value.local_end_time,
    sortOrder: value.sort_order,
  };
}

/**
 * The active itinerary's real, individually addressable items -- distinct from a proposal's
 * payload, which is a JSON blob with no stable per-activity id. RLS (`can_read_gemini_day`) only
 * ever exposes items belonging to an accepted, validated proposal with local times populated, so
 * this list is exactly "the active itinerary, in draggable form".
 */
export async function listActiveItineraryItems(client: SupabaseClient, tripId: string): Promise<ActiveItineraryItem[]> {
  const { data, error } = await client
    .from("itinerary_items")
    .select("id,itinerary_day_id,title,item_type,local_date,local_start_time,local_end_time,sort_order,itinerary_days!inner(trip_id)")
    .eq("itinerary_days.trip_id", tripId)
    .order("local_date", { ascending: true })
    .order("local_start_time", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export type ReorderRejection = { reason: string; staleRevision: boolean };

/** A drag's outcome: the moved item plus the trip's new revision, or a typed rejection reason. */
export async function reorderItineraryItem(
  client: SupabaseClient, tripId: string, itemId: string, expectedRevision: number, newDate: string, newStartTime: string,
): Promise<{ item: ActiveItineraryItem; revision: number }> {
  const { data, error } = await client.rpc("reorder_itinerary_item", {
    target_trip_id: tripId, target_item_id: itemId, expected_revision: expectedRevision,
    new_local_date: newDate, new_local_start_time: newStartTime,
  });
  if (error) databaseError(error);
  const row = Array.isArray(data) ? data[0] : data;
  const item = mapRow(row);
  const { data: trip, error: tripError } = await client.from("trips").select("revision").eq("id", tripId).single();
  if (tripError) databaseError(tripError);
  return { item, revision: z.object({ revision: z.number().int() }).parse(trip).revision };
}
