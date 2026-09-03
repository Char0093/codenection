import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/supabase/redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(safeRedirectPath(url.searchParams.get("next")), url.origin));
    } catch { /* Return the same public error for expired codes and unavailable auth. */ }
  }
  return NextResponse.redirect(new URL("/login?error=link_expired", url.origin));
}
