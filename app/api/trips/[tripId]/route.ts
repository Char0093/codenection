import { z } from "zod";
import { tripRepository } from "@/lib/repositories/server";
import { tripInputSchema } from "@/lib/domain/trip";
import { listMyDietaryConstraints } from "@/app/actions/constraints";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Context) {
  try {
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const repository = await tripRepository();
    const trip = await repository.getTrip(tripId);
    const proposals = await repository.listProposals(tripId);
    const dietaryFlags = await listMyDietaryConstraints(tripId);
    return Response.json({ trip, proposals, dietaryFlags }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const input = tripInputSchema.parse(await readJson(request));
    return Response.json({ trip: await (await tripRepository()).updateTrip(tripId, input) });
  } catch (error) { return errorResponse(error); }
}
