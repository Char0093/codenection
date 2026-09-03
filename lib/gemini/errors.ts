export type GeminiPlanningErrorCode =
  | "TIMEOUT"
  | "INVALID_JSON"
  | "INVALID_RESPONSE"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED";

const messages: Record<GeminiPlanningErrorCode, string> = {
  TIMEOUT: "Gemini planning timed out. Please try again.",
  INVALID_JSON: "Gemini returned invalid JSON.",
  INVALID_RESPONSE: "Gemini returned a proposal that does not match the required schema.",
  PROVIDER_ERROR: "Gemini could not generate a proposal. Please try again.",
  RATE_LIMITED: "Gemini is rate limited. Please try again later.",
  NOT_CONFIGURED: "Gemini planning is not configured correctly on the server.",
};

export class GeminiPlanningError extends Error {
  readonly code: GeminiPlanningErrorCode;

  constructor(code: GeminiPlanningErrorCode) {
    super(messages[code]);
    this.name = "GeminiPlanningError";
    this.code = code;
  }
}
