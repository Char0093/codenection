"use server";

import { z } from "zod";
import { tripRepository } from "@/lib/repositories/server";
import { planTrip } from "@/lib/gemini/trip-planner";
import { generateProposal } from "@/lib/services/trip-proposals";

export async function generateTripProposal(tripId: string) {
  z.string().uuid().parse(tripId);
  return generateProposal(tripId, await tripRepository(), planTrip);
}

export async function decideTripProposal(tripId: string, proposalId: string, decision: "accept" | "reject") {
  z.string().uuid().parse(tripId);
  z.string().uuid().parse(proposalId);
  z.enum(["accept", "reject"]).parse(decision);
  return (await tripRepository()).decideProposal(tripId, proposalId, decision);
}
