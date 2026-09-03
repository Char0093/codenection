import { afterEach, describe, expect, it, vi } from "vitest";
import { createTripPlanner, GeminiPlanningError, planTrip } from "@/lib/gemini/trip-planner";
import { proposal, request } from "./fixtures";

vi.mock("server-only", () => ({}));
const sdkGenerate = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: sdkGenerate }; } }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Gemini trip planner", () => {
  it("uses structured output and sends only validated trip data", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(proposal) });
    const planner = createTripPlanner({ client: { generateContent }, model: "test-model" });
    expect(await planner({ ...request, destinationName: " George Town " })).toEqual({ proposal, model: "test-model" });
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe("test-model");
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.maxOutputTokens).toBe(32768);
    expect(call.config.responseJsonSchema.properties.activities.items.properties.date).toBeDefined();
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(call.contents)).toEqual(request);
    expect(call.config.systemInstruction).toMatch(/no.*booking|never.*book/i);
    expect(call.config.systemInstruction).toMatch(/untrusted/i);
    expect(call.config.systemInstruction).toContain("15 to 480");
    expect(call.config.systemInstruction).toContain("at most 360 summed activity minutes per day");
  });
  it("public planTrip uses the server client and default model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fake-test-key");
    vi.stubEnv("GEMINI_MODEL", "");
    sdkGenerate.mockResolvedValue({ text: JSON.stringify(proposal) });
    expect(await planTrip(request)).toEqual({ proposal, model: "gemini-3.7-flash" });
    expect(sdkGenerate.mock.calls[0][0].config.responseJsonSchema).toBeDefined();
  });
  it("respects server model configuration", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fake-test-key");
    vi.stubEnv("GEMINI_MODEL", "custom-model");
    sdkGenerate.mockResolvedValue({ text: JSON.stringify(proposal) });
    expect((await planTrip(request)).model).toBe("custom-model");
  });
  it("reports missing server configuration without calling the SDK", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(planTrip(request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(sdkGenerate).not.toHaveBeenCalled();
  });
  it.each([
    [{ text: "not JSON" }, "INVALID_JSON"], [{ text: "{secret" }, "INVALID_JSON"],
    [{ text: JSON.stringify({ ...proposal, activities: [] }) }, "INVALID_RESPONSE"],
    [{ text: "null" }, "INVALID_RESPONSE"], [{}, "INVALID_RESPONSE"],
    [{ text: JSON.stringify({ ...proposal, active: true }) }, "INVALID_RESPONSE"],
  ])("maps malformed responses to stable errors", async (response, code) => {
    const planner = createTripPlanner({ client: { generateContent: vi.fn().mockResolvedValue(response) } });
    await expect(planner(request)).rejects.toBeInstanceOf(GeminiPlanningError);
    await expect(planner(request)).rejects.toMatchObject({ code });
  });
  it.each([[new Error("secret provider payload"), "PROVIDER_ERROR"], [{ status: 429, message: "secret provider payload" }, "RATE_LIMITED"]])("sanitizes provider failures", async (error, code) => {
    const planner = createTripPlanner({ client: { generateContent: vi.fn().mockRejectedValue(error) } });
    await expect(planner(request)).rejects.toMatchObject({ code });
    try { await planner(request); } catch (caught) {
      expect(String(caught)).not.toContain("secret");
      expect((caught as Error).cause).toBeUndefined();
    }
  });
  it("rejects sensitive and extra input before any provider call", async () => {
    const generateContent = vi.fn();
    const planner = createTripPlanner({ client: { generateContent } });
    await expect(planner({ ...request, notes: "I have a severe peanut allergy" })).rejects.toMatchObject({ name: "ZodError" });
    await expect(planner({ ...request, privateProfile: "secret" } as typeof request)).rejects.toMatchObject({ name: "ZodError" });
    expect(generateContent).not.toHaveBeenCalled();
  });
  it("times out even if a client ignores cancellation, and aborts it", async () => {
    vi.useFakeTimers();
    const generateContent = vi.fn().mockImplementation(() => new Promise(() => {}));
    const planner = createTripPlanner({ client: { generateContent }, timeoutMs: 50 });
    const result = expect(planner(request)).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(generateContent.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears the timeout after successful completion", async () => {
    vi.useFakeTimers();
    const planner = createTripPlanner({ client: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(proposal) }) } });
    await planner(request);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects oversized response text before JSON parsing", async () => {
    const planner = createTripPlanner({
      client: { generateContent: vi.fn().mockResolvedValue({ text: "{".repeat(600_000) }) },
    });
    await expect(planner(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
