import { tripRepository } from "@/lib/repositories/server";
import { tripInputSchema } from "@/lib/domain/trip";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ trips: await (await tripRepository()).listTrips() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = tripInputSchema.parse(await readJson(request));
    const trip = await (await tripRepository()).createTrip(input);
    return Response.json({ trip }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
