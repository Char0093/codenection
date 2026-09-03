import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError } from "@/lib/http/errors";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const publicRoute = path === "/login" || path.startsWith("/auth/");
  if (!isSupabaseConfigured()) {
    if (publicRoute || path.startsWith("/api/")) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values: { name: string; value: string; options: CookieOptions }[]) => {
        values.forEach((cookie) => pendingCookies.set(cookie.name, cookie));
      },
    },
  });
  let failure: AppError | undefined;
  try { await verifiedUser(client); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    failure = error;
  }
  const updates = [...pendingCookies.values()];
  const isLive = ({ value, options }: typeof updates[number]) => value !== "" &&
    (options.maxAge === undefined || options.maxAge > 0) && (!options.expires || options.expires.getTime() > Date.now());
  const cookieBase = (name: string) => name.replace(/\.\d+$/, "");
  const refreshed = new Set(updates.filter(isLive).map(({ name }) => cookieBase(name)));
  // Retain sessions on outages, but keep chunk cleanup paired with a successful token rotation.
  const cookies = updates.filter(({ name }) => failure?.status !== 503 || refreshed.has(cookieBase(name)));
  cookies.forEach((cookie) => {
    if (isLive(cookie)) request.cookies.set(cookie.name, cookie.value);
    else request.cookies.delete(cookie.name);
  });
  let response = NextResponse.next({ request });
  if (failure && !publicRoute) {
    response = failure.status === 401 && !path.startsWith("/api/")
      ? NextResponse.redirect(new URL("/login", request.url))
      : NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
  cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
