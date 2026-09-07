import { createClient } from "@/lib/supabase/server";
import { getChatHome } from "@/lib/repositories/chat-home";
import { createTripFrameSchema } from "@/lib/domain/trip";
import { AppError, errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

// Chat-group home (spec §2.3 / §5). GET lists the caller's trip groups; POST creates an
// organizer-framed trip + owner membership atomically via create_trip_group.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const home = await getChatHome(await createClient());
    return Response.json(home, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const frame = createTripFrameSchema.parse(await readJson(request));
    const client = await createClient();
    const { data, error } = await client.rpc("create_trip_group", {
      p_name: frame.name,
      p_destination: frame.destinationName,
      p_start_date: frame.startDate ?? null,
      p_end_date: frame.endDate ?? null,
      p_duration_days: frame.plannedDurationDays ?? null,
      p_trip_mode: frame.tripMode,
      p_proposed_budget_tier: frame.proposedBudgetTier,
      p_split_allowed: frame.splitAllowed,
    });
    if (error) {
      if (error.code === "42501") throw new AppError(401, "Please sign in to continue.", "UNAUTHENTICATED");
      if (error.code === "22023") {
        throw new AppError(422, "That trip frame is not valid. Check the destination, mode, and dates.", "INVALID_TRIP_FRAME");
      }
      throw new AppError(503, "The trip group could not be created. Please try again.", "STORAGE_UNAVAILABLE");
    }
    return Response.json({ tripId: data }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
