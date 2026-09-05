import { z } from "zod";
import { listMyDietaryConstraints, removeDietaryConstraint, setDietaryConstraint } from "@/app/actions/constraints";
import { dietaryFlagSchema } from "@/lib/domain/constraints";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

type Context = { params: Promise<{ tripId: string }> };
const bodySchema = z.object({ flag: dietaryFlagSchema });
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: Context) {
  try {
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const flags = await listMyDietaryConstraints(tripId);
    return Response.json({ flags }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { flag } = bodySchema.parse(await readJson(request));
    await setDietaryConstraint(tripId, flag);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { flag } = bodySchema.parse(await readJson(request));
    await removeDietaryConstraint(tripId, flag);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
