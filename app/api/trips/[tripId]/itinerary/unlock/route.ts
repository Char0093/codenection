import { z } from "zod";
import { unlockItineraryItem } from "@/lib/itinerary/repository";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
const bodySchema = z.object({
  itemId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
});
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { itemId, expectedRevision } = bodySchema.parse(await readJson(request));

    const client = await createClient();
    await verifiedUser(client);
    const result = await unlockItineraryItem(client, tripId, itemId, expectedRevision);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
