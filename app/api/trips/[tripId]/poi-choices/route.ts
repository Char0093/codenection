import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { errorResponse } from "@/lib/http/errors";
import { tripRepository } from "@/lib/repositories/server";
import { listCuratedPoisForRegion } from "@/lib/poi/repository";
import { buildChoicePool } from "@/lib/poi/choice-pool";
import { inferPoiRegion } from "@/lib/domain/poi-resolution";

type Context = { params: Promise<{ tripId: string }> };
export const dynamic = "force-dynamic";

/**
 * Task 3.4's choice pool for one selected date. Curated catalog rows are merged with provider
 * results when a place provider is configured; none is today, so the pool is honestly
 * corridor-only rather than padded with invented candidates (see lib/providers/types.ts).
 */
export async function GET(request: Request, context: Context) {
  try {
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const selectedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(new URL(request.url).searchParams.get("date"));

    const client = await createClient();
    await verifiedUser(client);
    const repository = await tripRepository();
    const trip = await repository.getTrip(tripId);

    const region = inferPoiRegion(trip.destinationName);
    if (!region) {
      return Response.json({ candidates: [], region: null }, { headers: { "cache-control": "no-store" } });
    }

    const [curated, confirmedConstraints, travelerCaps] = await Promise.all([
      listCuratedPoisForRegion(client, region),
      repository.listConfirmedConstraints(tripId),
      repository.listTravelerCaps(tripId),
    ]);

    const candidates = buildChoicePool({
      curated,
      confirmedConstraints,
      // Per-item numeric budget/mobility enforcement stays inert here for the same reason it is
      // inert in proposal validation: no numeric cost or leg distance exists to compare against.
      travelerCaps: travelerCaps.map((cap) => ({
        tripMemberId: cap.tripMemberId, remainingBudget: null, mobilityThresholdM: cap.mobilityThresholdM,
      })),
      selectedDate,
    });

    return Response.json({ candidates, region }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
