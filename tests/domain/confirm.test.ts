import { describe, expect, it } from "vitest";
import { checkConfirmation, consumeConfirmationToken, createConfirmationToken } from "@/lib/domain/confirm";

const NOW = 1_000_000;

describe("confirmation primitive", () => {
  it("accepts the right actor within the window", () => {
    const token = createConfirmationToken("member-1", NOW, 60_000);
    expect(checkConfirmation(token, "member-1", NOW + 1000)).toEqual({ ok: true, token });
  });

  it("rejects a missing token", () => {
    expect(checkConfirmation(undefined, "member-1", NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects the wrong actor", () => {
    const token = createConfirmationToken("member-1", NOW, 60_000);
    expect(checkConfirmation(token, "member-2", NOW)).toEqual({ ok: false, reason: "wrong_actor" });
  });

  it("rejects an expired token", () => {
    const token = createConfirmationToken("member-1", NOW, 1000);
    expect(checkConfirmation(token, "member-1", NOW + 1001)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a replay after the token has been consumed", () => {
    const token = createConfirmationToken("member-1", NOW, 60_000);
    const consumed = consumeConfirmationToken(token, NOW + 10);
    expect(checkConfirmation(consumed, "member-1", NOW + 20)).toEqual({ ok: false, reason: "already_used" });
  });

  it("refuses a double-accept: applying twice never succeeds twice", () => {
    const token = createConfirmationToken("member-1", NOW, 60_000);
    const first = checkConfirmation(token, "member-1", NOW);
    expect(first.ok).toBe(true);
    const consumed = consumeConfirmationToken((first as { ok: true; token: typeof token }).token, NOW + 1);
    const second = checkConfirmation(consumed, "member-1", NOW + 2);
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("never mutates the original token in place", () => {
    const token = createConfirmationToken("member-1", NOW, 60_000);
    consumeConfirmationToken(token, NOW + 1);
    expect(token.consumedAt).toBeNull();
  });
});
