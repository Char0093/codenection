import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrototype } from "@/lib/prototype/config";

// The user-flagged guardrail: a production deploy with missing Supabase env vars must NOT
// slip into prototype mode (which bypasses auth). Only the explicit flag, or a dev build with
// no Supabase, may.
afterEach(() => vi.unstubAllEnvs());

const noSupabase = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
};
const realSupabase = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://real.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "real-anon-key");
};

describe("isPrototype", () => {
  it("is true when NEXT_PUBLIC_PROTOTYPE=1, even in production with real Supabase", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PROTOTYPE", "1");
    realSupabase();
    expect(isPrototype()).toBe(true);
  });

  it("is FALSE in production when Supabase env vars are missing (no silent auth bypass)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_PROTOTYPE", "");
    noSupabase();
    expect(isPrototype()).toBe(false);
  });

  it("is true in a dev build with no Supabase configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_PROTOTYPE", "");
    noSupabase();
    expect(isPrototype()).toBe(true);
  });

  it("is false in a dev build once Supabase is configured and the flag is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_PROTOTYPE", "");
    realSupabase();
    expect(isPrototype()).toBe(false);
  });
});
