import { describe, expect, it } from "vitest";
import { AppError, databaseError } from "@/lib/http/errors";

function thrownBy(error: { code?: string; message?: string }): AppError {
  try {
    databaseError(error);
  } catch (thrown) {
    return thrown as AppError;
  }
  throw new Error("databaseError did not throw");
}

// Direct coverage of the shared SQLSTATE -> AppError table; individual actions have their own
// mapRpcError tests, but this table itself had no dedicated test before the program audit
// added the P0004 chat-rate-limit case (202609070001).
describe("databaseError", () => {
  it("maps P0004 (chat_messages rate-limit trigger) to 429 RATE_LIMITED with a chat-specific message", () => {
    const thrown = thrownBy({ code: "P0004" });
    expect(thrown.status).toBe(429);
    expect(thrown.code).toBe("RATE_LIMITED");
    expect(thrown.message).toMatch(/too many messages/i);
  });

  it("maps P0003 (generation/assistant rate limits) to 429 RATE_LIMITED with a distinct message from P0004", () => {
    const thrown = thrownBy({ code: "P0003" });
    expect(thrown.status).toBe(429);
    expect(thrown.code).toBe("RATE_LIMITED");
    expect(thrown.message).not.toMatch(/too many messages/i);
  });

  it("maps 42501 to 403 FORBIDDEN", () => {
    const thrown = thrownBy({ code: "42501" });
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe("FORBIDDEN");
  });

  it("falls back to 503 STORAGE_UNAVAILABLE for an unmapped code", () => {
    const thrown = thrownBy({ code: "99999" });
    expect(thrown.status).toBe(503);
    expect(thrown.code).toBe("STORAGE_UNAVAILABLE");
  });
});
