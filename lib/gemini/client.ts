import "server-only";
import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { GeminiPlanningError } from "./errors";

export interface GeminiClient {
  generateContent(parameters: GenerateContentParameters): Promise<{ text?: string }>;
}

export function createGeminiClient(): GeminiClient {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiPlanningError("NOT_CONFIGURED");
  const client = new GoogleGenAI({ apiKey });
  return {
    generateContent: (parameters) => client.models.generateContent(parameters),
  };
}
