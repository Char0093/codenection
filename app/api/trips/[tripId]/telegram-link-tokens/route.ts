import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createTelegramLinkToken } from "@/lib/telegram/link-tokens";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ tripId: string }> }) {
  try {
    requireSameOrigin(request);
    const { tripId } = await context.params;
    z.string().uuid().parse(tripId);
    const { memberId } = z.object({ memberId: z.string().uuid() }).strict().parse(await readJson(request));
    const { token, expiresAt } = await createTelegramLinkToken(await createClient(), tripId, memberId);
    return Response.json({ link: { token, expiresAt } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
