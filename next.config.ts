import type { NextConfig } from "next";

/** REST calls hit the Supabase project's https origin; Realtime subscriptions upgrade the
 * same host to a WebSocket, so connect-src needs both or Realtime silently fails to connect.
 * Read from env (mirrors lib/supabase/config.ts's isSupabaseConfigured guard) rather than
 * hardcoded, since the project ref differs per environment. */
function supabaseConnectOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return [`${url.protocol}//${url.host}`, `wss://${url.host}`];
  } catch {
    return [];
  }
}

function buildContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    // next/font self-hosts Google fonts at build time (no fonts.googleapis.com/gstatic.com
    // dependency), so font-src needs nothing beyond 'self'. script-src and style-src keep
    // 'unsafe-inline': Next's App Router injects small inline hydration/streaming scripts on
    // every page, and several components (the calendar/jigsaw timeline, the onboarding
    // progress bar) position elements via inline style={{}}. Next supports nonce-based
    // script-src natively, which would drop 'unsafe-inline' from script-src -- a real
    // follow-up, but one that needs its own pass verifying hydration across every route
    // rather than a silent change bundled into this fix.
    // 'unsafe-eval' is added only outside production: webpack's dev-mode module format
    // evaluates chunks via `eval()` for fast incremental rebuilds (confirmed by an actual
    // CSP violation against `next dev` without it); a `next build && next start` production
    // run does not use eval and stays strict.
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${["'self'", ...supabaseConnectOrigins()].join(" ")}`,
  ].join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
        ],
      },
    ];
  },
};

export default nextConfig;
