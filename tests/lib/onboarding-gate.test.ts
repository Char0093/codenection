import { describe, expect, it } from "vitest";
import { isGateExempt, isOnboardingComplete } from "@/lib/onboarding/gate";

describe("isGateExempt", () => {
  it.each(["/api/onboarding", "/api/trips/x", "/onboarding", "/onboarding/step/2"])("is true for %s", (p) => {
    expect(isGateExempt(p)).toBe(true);
  });
  it.each(["/", "/preferences", "/chats", "/trips/abc/workspace", "/login", "/auth/callback"])("is false for %s", (p) => {
    expect(isGateExempt(p)).toBe(false);
  });
});

describe("isOnboardingComplete", () => {
  const client = (result: { data: unknown; error: unknown }) => ({
    from: () => ({ select: () => ({ maybeSingle: async () => result }) }),
  });
  it("is true only when a row carries a non-null onboarding_completed_at", async () => {
    expect(await isOnboardingComplete(client({ data: { onboarding_completed_at: "2026-09-07T00:00:00Z" }, error: null }))).toBe(true);
    expect(await isOnboardingComplete(client({ data: { onboarding_completed_at: null }, error: null }))).toBe(false);
    expect(await isOnboardingComplete(client({ data: null, error: null }))).toBe(false);
  });
  it("fails open (true) on a database error so a blip cannot trap users at /onboarding", async () => {
    expect(await isOnboardingComplete(client({ data: null, error: { code: "503" } }))).toBe(true);
  });
});
