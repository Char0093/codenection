import { z } from "zod";
import { getMyMemberEntryContext, submitMyMemberEntry } from "@/app/actions/member-entry";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

// Per-trip member entry (spec §2.4 / §3.3). GET assembles the organizer preview + the
// caller's saved safety + current entry + the aggregate alignment summary; POST upserts the
// caller's entry through submit_member_entry.
type Context = { params: Promise<{ tripId: string }> };
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Context) {
  try {
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const data = await getMyMemberEntryContext(tripId);
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const result = await submitMyMemberEntry(tripId, await readJson(request));
    return Response.json(result, { status: 200 });
  } catch (error) { return errorResponse(error); }
}
