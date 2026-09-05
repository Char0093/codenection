import { z } from "zod";
import { getScheduledItemContext, reorderItineraryItem } from "@/lib/itinerary/repository";
import { tripRepository } from "@/lib/repositories/server";
import { assertPlacementAllowed } from "@/lib/poi/schedule-validation";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
const bodySchema = z.object({
  itemId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Resize: omitted for a pure move, which preserves the item's current duration. */
  durationMinutes: z.number().int().min(15).max(480).optional(),
});
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { itemId, expectedRevision, newDate, newStartTime, durationMinutes } = bodySchema.parse(await readJson(request));

    const client = await createClient();
    await verifiedUser(client);

    // A move or resize changes when the visit happens, so a pool-scheduled block has to clear the
    // same opening-hours, destination and constraint checks its original placement did. A Gemini
    // block has no catalog row behind it, so only the schedule rules in the RPC apply.
    const scheduled = await getScheduledItemContext(client, tripId, itemId);
    let hoursWarning: string | null = null;
    if (scheduled?.poiId) {
      const check = await assertPlacementAllowed(client, await tripRepository(), {
        tripId, poiId: scheduled.poiId, localDate: newDate, startTime: newStartTime,
        durationMinutes: durationMinutes ?? scheduled.durationMinutes,
      });
      hoursWarning = check.hoursWarning ?? null;
    }

    const result = await reorderItineraryItem(client, tripId, itemId, expectedRevision, newDate, newStartTime, durationMinutes);
    return Response.json({ ...result, hoursWarning });
  } catch (error) {
    return errorResponse(error);
  }
}
