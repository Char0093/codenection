import { z } from "zod";
import { askTripAssistant } from "@/app/actions/assistant";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
const bodySchema = z.object({ question: z.string().trim().min(1).max(4000) });

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { question } = bodySchema.parse(await readJson(request));
    const result = await askTripAssistant(tripId, question);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
