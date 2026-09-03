import { ZodError } from "zod";
import { GeminiPlanningError } from "@/lib/gemini/errors";
import { GeminiProposalValidationError } from "@/lib/domain/gemini-proposal-validation";

export class AppError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "REQUEST_FAILED") {
    super(message);
    this.name = "AppError";
  }
}

export function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === "42501") throw new AppError(403, "You do not have permission to change this trip.", "FORBIDDEN");
  if (error.code === "P0002" || error.code === "PGRST116") throw new AppError(404, "Trip or proposal not found.", "NOT_FOUND");
  if (error.code === "P0003" || error.message?.includes("rate_limit")) throw new AppError(429, "Too many generation requests. Try again later.", "RATE_LIMITED");
  if (error.code === "40001" || error.code === "P0001") throw new AppError(409, "This proposal is no longer current. Reload the trip and generate a new proposal.", "CONFLICT");
  if (error.code?.startsWith("22") || error.code === "23514") throw new AppError(422, "The trip or proposal did not pass validation.", "VALIDATION_FAILED");
  throw new AppError(503, "Trip storage is unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export function errorResponse(error: unknown): Response {
  if (error instanceof GeminiProposalValidationError) {
    return Response.json({ error: error.message, code: "VALIDATION_FAILED" }, { status: 422 });
  }
  if (error instanceof GeminiPlanningError) {
    const status = error.code === "TIMEOUT" ? 504 : error.code === "RATE_LIMITED" ? 429 : error.code === "NOT_CONFIGURED" ? 503 : 502;
    return Response.json({ error: error.message, code: error.code }, { status, headers: status === 429 ? { "Retry-After": "60" } : undefined });
  }
  if (error instanceof AppError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: error.status === 429 ? { "Retry-After": "600" } : undefined });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues.map((issue) => issue.message).join(" "), code: "VALIDATION_FAILED" }, { status: 422 });
  }
  return Response.json({ error: "The request could not be completed. Please try again.", code: "INTERNAL_ERROR" }, { status: 500 });
}
