import { z } from "zod";
import { schedulePoiItem } from "@/lib/itinerary/repository";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
const bodySchema = z.object({
  poiId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(15).max(480),
  itemType: z.enum(["culture", "food", "nature", "shopping", "transit"]),
});
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const body = bodySchema.parse(await readJson(request));

    const client = await createClient();
    await verifiedUser(client);
    const result = await schedulePoiItem(
      client, tripId, body.poiId, body.expectedRevision,
      body.localDate, body.startTime, body.durationMinutes, body.itemType,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
