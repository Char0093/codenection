import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/http/request";
import { errorResponse } from "@/lib/http/errors";
import { authenticationError } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    // Prototype/demo builds have no Supabase session to sign out of -- createClient() throws
    // NOT_CONFIGURED here otherwise, and this route is reachable from the sidebar's always-visible
    // Log out link, unlike the trip/data routes the prototype UI never calls. Just bounce to /login.
    if (isSupabaseConfigured()) {
      const { error } = await (await createClient()).auth.signOut();
      if (error) throw authenticationError(error);
    }
    return NextResponse.redirect(new URL("/login", request.url), 303);
  } catch (error) { return errorResponse(error); }
}
