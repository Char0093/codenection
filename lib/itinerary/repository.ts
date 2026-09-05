import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError, databaseError } from "@/lib/http/errors";

/**
 * A move/resize/unlock refusal must show its specific reason on the card (Task 3.4), unlike most
 * other database errors in this app, which stay generic to avoid leaking raw Postgres text. These
 * three RPCs only ever raise a small, deliberately-written set of user-facing messages under these
 * codes, so it is safe to pass them straight through instead of collapsing to a blanket message.
 */
function itineraryEditError(error: { code?: string; message?: string }): never {
  if (error.code === "40001") throw new AppError(409, "Someone already changed this trip. Reloading the latest itinerary.", "CONFLICT");
  if (error.code === "P0002") throw new AppError(404, error.message?.trim() || "Activity not found.", "NOT_FOUND");
  if (error.code === "23514" || error.code?.startsWith("22")) {
    throw new AppError(422, error.message?.trim() || "That change was refused.", "VALIDATION_FAILED");
  }
  databaseError(error);
}

export type ActiveItineraryItem = {
  id: string;
  dayId: string;
  title: string;
  category: string;
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  sortOrder: number;
  /** Locked by default (Task 3.4): must be explicitly unlocked before it can be moved or resized. */
  fixedCommitment: boolean;
  /** Minutes of required travel arriving at this item. 0 (the column default) means "no travel
   * data yet" -- see travel-block.tsx -- not "zero travel confirmed". */
  travelMinutes: number;
  /** Set when the block was scheduled from the POI choice pool. Only these can be returned to it. */
  poiId: string | null;
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
  fixed_commitment: z.boolean(),
  travel_minutes: z.number().int(),
  poi_id: z.string().uuid().nullable(),
});

function mapRow(row: unknown): ActiveItineraryItem {
  const value = rowSchema.parse(row);
  return {
    id: value.id, dayId: value.itinerary_day_id, title: value.title, category: value.item_type,
    localDate: value.local_date, localStartTime: value.local_start_time, localEndTime: value.local_end_time,
    sortOrder: value.sort_order, fixedCommitment: value.fixed_commitment, travelMinutes: value.travel_minutes,
    poiId: value.poi_id,
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
    .select("id,itinerary_day_id,title,item_type,local_date,local_start_time,local_end_time,sort_order,fixed_commitment,travel_minutes,poi_id,itinerary_days!inner(trip_id)")
    .eq("itinerary_days.trip_id", tripId)
    .order("local_date", { ascending: true })
    .order("local_start_time", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

async function currentRevision(client: SupabaseClient, tripId: string): Promise<number> {
  const { data: trip, error } = await client.from("trips").select("revision").eq("id", tripId).single();
  if (error) databaseError(error);
  return z.object({ revision: z.number().int() }).parse(trip).revision;
}

export type ReorderRejection = { reason: string; staleRevision: boolean };

/**
 * A drag or resize's outcome: the changed item plus the trip's new revision, or a typed rejection
 * reason. `durationMinutes` is omitted for a pure move (preserves the item's current duration) and
 * supplied for a resize, optionally combined with a move in the same call.
 */
export async function reorderItineraryItem(
  client: SupabaseClient, tripId: string, itemId: string, expectedRevision: number,
  newDate: string, newStartTime: string, durationMinutes?: number,
): Promise<{ item: ActiveItineraryItem; revision: number }> {
  const { data, error } = await client.rpc("reorder_itinerary_item", {
    target_trip_id: tripId, target_item_id: itemId, expected_revision: expectedRevision,
    new_local_date: newDate, new_local_start_time: newStartTime,
    ...(durationMinutes === undefined ? {} : { new_duration_minutes: durationMinutes }),
  });
  if (error) itineraryEditError(error);
  const row = Array.isArray(data) ? data[0] : data;
  const item = mapRow(row);
  const revision = await currentRevision(client, tripId);
  return { item, revision };
}

/**
 * Task 3.4: schedule a pool POI onto the selected day. `itemType` is the caller's deterministic
 * pool-category mapping (lib/poi/choice-pool.ts) rather than something the database derives, and
 * the RPC validates it against the same five categories the rest of the system uses.
 */
export async function schedulePoiItem(
  client: SupabaseClient, tripId: string, poiId: string, expectedRevision: number,
  localDate: string, startTime: string, durationMinutes: number, itemType: string,
): Promise<{ item: ActiveItineraryItem; revision: number }> {
  const { data, error } = await client.rpc("schedule_poi_item", {
    target_trip_id: tripId, target_poi_id: poiId, expected_revision: expectedRevision,
    new_local_date: localDate, new_local_start_time: startTime,
    new_duration_minutes: durationMinutes, new_item_type: itemType,
  });
  if (error) itineraryEditError(error);
  const row = Array.isArray(data) ? data[0] : data;
  const item = mapRow(row);
  const revision = await currentRevision(client, tripId);
  return { item, revision };
}

/** Returns the block to the pool: the itinerary row is deleted, the poi_catalog row is untouched. */
export async function unschedulePoiItem(
  client: SupabaseClient, tripId: string, itemId: string, expectedRevision: number,
): Promise<{ poiId: string; revision: number }> {
  const { data, error } = await client.rpc("unschedule_itinerary_item", {
    target_trip_id: tripId, target_item_id: itemId, expected_revision: expectedRevision,
  });
  if (error) itineraryEditError(error);
  const poiId = z.string().uuid().parse(Array.isArray(data) ? data[0] : data);
  const revision = await currentRevision(client, tripId);
  return { poiId, revision };
}

/** Task 3.4: the only way to make a `fixedCommitment` item editable again -- a real, persisted
 * confirmation, not a client-only toggle that the server would reject anyway. */
export async function unlockItineraryItem(
  client: SupabaseClient, tripId: string, itemId: string, expectedRevision: number,
): Promise<{ item: ActiveItineraryItem; revision: number }> {
  const { data, error } = await client.rpc("unlock_itinerary_item", {
    target_trip_id: tripId, target_item_id: itemId, expected_revision: expectedRevision,
  });
  if (error) itineraryEditError(error);
  const row = Array.isArray(data) ? data[0] : data;
  const item = mapRow(row);
  const revision = await currentRevision(client, tripId);
  return { item, revision };
}
