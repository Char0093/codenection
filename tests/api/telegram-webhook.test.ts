import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), redeem: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/telegram/link-tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram/link-tokens")>();
  return { ...actual, redeemTelegramLinkToken: mocks.redeem };
});

import { POST } from "@/app/api/telegram/webhook/route";

const token = "wpt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12";
const request = (body: unknown, secret = "test-secret") => new Request("https://trip.test/api/telegram/webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret },
  body: JSON.stringify(body),
});

describe("Telegram webhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    mocks.createClient.mockReturnValue({ rpc: vi.fn() });
    mocks.redeem.mockResolvedValue({ tripId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "member" });
  });

  it("rejects requests without the configured Telegram secret", async () => {
    const response = await POST(request({}, "wrong"));
    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("ignores non-link updates", async () => {
    const response = await POST(request({ message: { text: "/status", from: { id: 12345, first_name: "Amira" } } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, handled: false });
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("redeems /start link tokens with the anonymous Supabase client", async () => {
    const response = await POST(request({ message: { text: `/start ${token}`, from: { id: 12345, first_name: "Amira", last_name: "Tan" } } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, handled: true, tripId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "member" });
    expect(mocks.createClient).toHaveBeenCalledWith("https://auth-test.supabase.co", "anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(mocks.redeem).toHaveBeenCalledWith(expect.anything(), token, "12345", "Amira Tan");
  });
});
