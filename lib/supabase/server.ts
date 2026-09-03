import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "@/lib/http/errors";
import { isSupabaseConfigured } from "./config";

export async function createClient() {
  if (!isSupabaseConfigured()) throw new AppError(503, "Sign-in is not configured yet.", "NOT_CONFIGURED");
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values: { name: string; value: string; options: CookieOptions }[]) => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch {
          // Server components cannot write cookies; middleware refreshes their session.
        }
      },
    },
  });
}
