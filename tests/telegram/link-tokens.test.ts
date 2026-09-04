import { describe, expect, it, vi } from "vitest";
import { equalTokenHash, generateTelegramLinkToken, hashTelegramLinkToken, redeemTelegramLinkToken } from "@/lib/telegram/link-tokens";

describe("Telegram link tokens", () => {
  it("generates opaque tokens with a stable SHA-256 hash and expiry", () => {
    const token = generateTelegramLinkToken(new Date("2026-09-04T00:00:00.000Z"));
    expect(token.token).toMatch(/^wpt_[A-Za-z0-9_-]{43}$/);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).toBe(hashTelegramLinkToken(token.token));
    expect(token.expiresAt).toBe("2026-09-04T00:15:00.000Z");
    expect(equalTokenHash(token.tokenHash, hashTelegramLinkToken(token.token))).toBe(true);
    expect(equalTokenHash(token.tokenHash, "0".repeat(64))).toBe(false);
  });

  it("rejects malformed raw tokens before hashing", () => {
    expect(() => hashTelegramLinkToken("plain-token")).toThrow();
  });

  it("redeems through the narrow RPC without exposing the raw token", async () => {
    const token = generateTelegramLinkToken();
    const rpc = vi.fn().mockResolvedValue({ data: {
      trip_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      member_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role: "member",
      display_name: "Amira",
    }, error: null });
    const result = await redeemTelegramLinkToken({ rpc } as never, token.token, "12345", " Amira ");
    expect(result).toEqual({
      tripId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      memberId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role: "member",
      displayName: "Amira",
    });
    expect(rpc).toHaveBeenCalledWith("redeem_telegram_link_token", {
      token_hash: token.tokenHash,
      telegram_user_id: "12345",
      display_name: "Amira",
    });
  });
});
