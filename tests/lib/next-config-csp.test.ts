import { afterEach, describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

// Program audit fix: next.config.ts previously set no Content-Security-Policy at all.
const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
});

async function headerValues(): Promise<Record<string, string>> {
  const groups = await nextConfig.headers!();
  return Object.fromEntries(groups[0].headers.map((header) => [header.key, header.value]));
}

describe("next.config Content-Security-Policy", () => {
  it("includes the directives the audit asked for at minimum", async () => {
    const csp = (await headerValues())["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("also denies framing via the legacy header, and sets nosniff", async () => {
    const headers = await headerValues();
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("scopes connect-src to the configured Supabase project's https and wss origins", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcxyz.supabase.co";
    const csp = (await headerValues())["Content-Security-Policy"];
    const connectSrc = csp.split("; ").find((directive) => directive.startsWith("connect-src"));
    expect(connectSrc).toContain("https://abcxyz.supabase.co");
    expect(connectSrc).toContain("wss://abcxyz.supabase.co");
  });

  it("still emits a well-formed connect-src when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const csp = (await headerValues())["Content-Security-Policy"];
    const connectSrc = csp.split("; ").find((directive) => directive.startsWith("connect-src"));
    expect(connectSrc).toBe("connect-src 'self'");
  });

  it("does not crash on a malformed Supabase URL, and still scopes to 'self'", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    const csp = (await headerValues())["Content-Security-Policy"];
    const connectSrc = csp.split("; ").find((directive) => directive.startsWith("connect-src"));
    expect(connectSrc).toBe("connect-src 'self'");
  });
});
