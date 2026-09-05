import { z } from "zod";
import { reorderItineraryItem } from "@/lib/itinerary/repository";
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
});
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { itemId, expectedRevision, newDate, newStartTime } = bodySchema.parse(await readJson(request));

    const client = await createClient();
    await verifiedUser(client);
    const result = await reorderItineraryItem(client, tripId, itemId, expectedRevision, newDate, newStartTime);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
