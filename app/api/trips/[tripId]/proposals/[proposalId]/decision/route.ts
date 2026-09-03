import { z } from "zod";
import { decideTripProposal } from "@/app/actions/proposals";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

export async function POST(request: Request, context: { params: Promise<{ tripId: string; proposalId: string }> }) {
  try {
    requireSameOrigin(request);
    const { tripId, proposalId } = await context.params;
    const { decision } = z.object({ decision: z.enum(["accept", "reject"]) }).strict().parse(await readJson(request));
    return Response.json({ proposal: await decideTripProposal(tripId, proposalId, decision) });
  } catch (error) { return errorResponse(error); }
}
