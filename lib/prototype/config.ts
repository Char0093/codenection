import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Prototype mode swaps the Supabase + Gemini data path for hardcoded fixtures so the app is
 * clickable end to end with no backend. It is deliberately hard to fall into by accident:
 *
 *   - `NEXT_PUBLIC_PROTOTYPE=1` turns it on anywhere (local, a demo deploy, CI).
 *   - Otherwise it is a DEV-ONLY convenience: a local build with no Supabase configured runs
 *     as the prototype instead of dead-ending at a disabled sign-in form.
 *
 * A production build with missing/blank Supabase env vars does NOT become the prototype -- it
 * fails exactly as it does today. That keeps a misconfigured production deployment from
 * silently bypassing authentication. The `wp_prototype` cookie is only a "which demo persona"
 * marker set on demo entry; nothing security-relevant keys off it -- middleware decides the
 * auth bypass purely from this function.
 *
 * Isomorphic: every input is a `NEXT_PUBLIC_*` value or `NODE_ENV`, so it returns the same
 * answer in middleware, server components, and the browser.
 */
export function isPrototype(): boolean {
  if (process.env.NEXT_PUBLIC_PROTOTYPE === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return !isSupabaseConfigured();
}
