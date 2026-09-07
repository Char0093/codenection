import { getMyUserOnboarding, submitUserOnboarding } from "@/app/actions/user-onboarding";
import { errorResponse } from "@/lib/http/errors";
import { readJson, requireSameOrigin } from "@/lib/http/request";

// Global first-login onboarding. No path params. Exempt from the middleware gate
// (`/api/` prefix) so it can accept the submission that clears the gate.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getMyUserOnboarding();
    return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const result = await submitUserOnboarding(await readJson(request));
    return Response.json(result, { status: 200 });
  } catch (error) { return errorResponse(error); }
}
