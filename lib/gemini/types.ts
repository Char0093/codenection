import type { z } from "zod";
import type { geminiActivitySchema, geminiTripProposalSchema, geminiTripRequestSchema } from "./schemas";

export type GeminiTripRequest = z.infer<typeof geminiTripRequestSchema>;
export type GeminiActivity = z.infer<typeof geminiActivitySchema>;
export type GeminiTripProposal = z.infer<typeof geminiTripProposalSchema>;
