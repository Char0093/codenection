"use server";

import { z } from "zod";
import { askAssistant } from "@/lib/chat/assistant";
import { listMessages } from "@/lib/chat/repository";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { tripRepository } from "@/lib/repositories/server";
import { AppError, databaseError } from "@/lib/http/errors";

const tripIdSchema = z.string().uuid();

/**
 * Task 3.3: any trip member may prompt the assistant. It never mutates state itself -- a
 * suggested change lands as a pending agent_proposals row via save_chat_proposal, which only the
 * trip owner can later accept through the existing decide_trip_proposal gate; a plain answer
 * posts directly as an assistant chat message via post_assistant_message.
 */
export async function askTripAssistant(tripId: string, question: string) {
  tripIdSchema.parse(tripId);
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) throw new AppError(422, "Ask the assistant something first.", "VALIDATION_FAILED");

  const client = await createClient();
  const user = await verifiedUser(client);
  const { data: member, error: memberError } = await client
    .from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
  if (memberError) databaseError(memberError);
  if (!member) throw new AppError(403, "You are not a member of this trip.", "FORBIDDEN");

  const { error: reservationError } = await client.rpc("reserve_generation", { target_trip_id: tripId });
  if (reservationError) databaseError(reservationError);

  const repository = await tripRepository();
  const trip = await repository.getTrip(tripId);
  const recentMessages = await listMessages(client, tripId, 20);

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.7-flash";
  const reply = await askAssistant(trip, recentMessages, trimmedQuestion, { model });

  if (reply.proposal) {
    const { error } = await client.rpc("save_chat_proposal", {
      target_trip_id: tripId, author_member_id: member.id,
      proposal_payload: reply.proposal, model_identifier: model, announcement: reply.message,
    });
    if (error) databaseError(error);
  } else {
    const { error } = await client.rpc("post_assistant_message", { target_trip_id: tripId, body: reply.message });
    if (error) databaseError(error);
  }

  return { message: reply.message, proposed: reply.proposal !== null };
}
