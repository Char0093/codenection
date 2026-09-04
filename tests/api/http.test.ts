import { describe, expect, it } from "vitest";
import { readJson, requireSameOrigin } from "@/lib/http/request";
import { safeRedirectPath } from "@/lib/supabase/redirect";

describe("HTTP boundaries", () => {
  it("accepts same-origin writes", () => {
    expect(() => requireSameOrigin(new Request("https://trip.test/api/trips", { method: "POST", headers: { Origin: "https://trip.test" } }))).not.toThrow();
  });
  it("accepts same-port localhost and 127.0.0.1 loopback aliases", () => {
    expect(() => requireSameOrigin(new Request("http://localhost:3001/api/trips", { method: "POST", headers: { Origin: "http://127.0.0.1:3001" } }))).not.toThrow();
  });
  it("blocks loopback aliases on a different port", () => {
    expect(() => requireSameOrigin(new Request("http://localhost:3001/api/trips", { method: "POST", headers: { Origin: "http://127.0.0.1:3002" } }))).toThrow();
  });
  it.each(["https://evil.test", "null", ""])("blocks cross-origin or missing origin %s", (origin) => {
    expect(() => requireSameOrigin(new Request("https://trip.test/api/trips", { method: "POST", headers: { Origin: origin } }))).toThrow();
  });
  it("parses JSON", async () => {
    expect(await readJson(new Request("https://trip.test", { method: "POST", body: '{"decision":"reject"}' }))).toEqual({ decision: "reject" });
  });
  it("rejects malformed JSON", async () => {
    await expect(readJson(new Request("https://trip.test", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
  });
  it("bounds request size even without content-length", async () => {
    await expect(readJson(new Request("https://trip.test", { method: "POST", body: "x".repeat(17000) }))).rejects.toMatchObject({ status: 413 });
  });
  it.each(["//evil.test", "https://evil.test", "/\\evil.test", "/%5cevil.test", null])("rejects unsafe callback redirect %s", (path) => {
    expect(safeRedirectPath(path)).toBe("/");
  });
  it("retains an internal trip URL", () => expect(safeRedirectPath("/?trip=123")).toBe("/?trip=123"));
});
