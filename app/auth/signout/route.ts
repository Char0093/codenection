import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/http/request";
import { errorResponse } from "@/lib/http/errors";
import { authenticationError } from "@/lib/supabase/auth";
import { mockAccountCookie, mockAccountsEnabled } from "@/lib/mock/accounts";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (isSupabaseConfigured()) {
      const { error } = await (await createClient()).auth.signOut();
      if (error) throw authenticationError(error);
    }
    const response = NextResponse.redirect(new URL("/login", request.headers.get("origin") ?? request.url), 303);
    if (mockAccountsEnabled()) response.cookies.delete(mockAccountCookie);
    return response;
  } catch (error) { return errorResponse(error); }
}
