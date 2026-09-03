import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/http/request";
import { errorResponse } from "@/lib/http/errors";
import { authenticationError } from "@/lib/supabase/auth";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { error } = await (await createClient()).auth.signOut();
    if (error) throw authenticationError(error);
    return NextResponse.redirect(new URL("/login", request.url), 303);
  } catch (error) { return errorResponse(error); }
}
