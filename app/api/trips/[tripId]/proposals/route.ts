import { generateTripProposal } from "@/app/actions/proposals";
import { errorResponse } from "@/lib/http/errors";
import { requireSameOrigin } from "@/lib/http/request";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ tripId: string }> }) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    return Response.json({ proposal: await generateTripProposal(tripId) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
