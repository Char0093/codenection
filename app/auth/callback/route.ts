import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/supabase/redirect";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Prototype/demo login never routes through the Supabase OTP flow (see PrototypeEntry in
  // login-form.tsx), so this isn't reachable there today -- guarded anyway so createClient()
  // never throws NOT_CONFIGURED here if that ever changes, matching /auth/signout.
  if (code && isSupabaseConfigured()) {
    try {
      const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeRedirectPath(url.searchParams.get("next")), url.origin));
    } catch { /* Return the same public error for expired codes and unavailable auth. */ }
  }
  return NextResponse.redirect(new URL("/login?error=link_expired", url.origin));
}
