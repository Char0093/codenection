"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { defaultSeverity, dietaryFlagSchema } from "@/lib/domain/constraints";

const tripIdSchema = z.string().uuid();

async function myMembership(client: Awaited<ReturnType<typeof createClient>>, tripId: string) {
  const user = await verifiedUser(client);
  const { data, error } = await client
    .from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  return data.id as string;
}

export async function listMyDietaryConstraints(tripId: string) {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  const memberId = await myMembership(client, tripId);
  const { data, error } = await client
    .from("trip_constraints").select("flag")
    .eq("trip_id", tripId).eq("trip_member_id", memberId).eq("kind", "dietary");
  if (error) databaseError(error);
  return (data ?? []).map((row) => dietaryFlagSchema.parse(row.flag));
}

export async function setDietaryConstraint(tripId: string, flag: string) {
  tripIdSchema.parse(tripId);
  const parsedFlag = dietaryFlagSchema.parse(flag);
  const client = await createClient();
  const memberId = await myMembership(client, tripId);
  const { error } = await client.from("trip_constraints").insert({
    trip_id: tripId, trip_member_id: memberId, kind: "dietary", flag: parsedFlag,
    severity: defaultSeverity(parsedFlag), source: "manual",
    confirmed_by: memberId, confirmed_at: new Date().toISOString(),
  });
  // 23505 = already selected; tapping an already-set button is a no-op, not an error.
  if (error && error.code !== "23505") databaseError(error);
}

export async function removeDietaryConstraint(tripId: string, flag: string) {
  tripIdSchema.parse(tripId);
  const parsedFlag = dietaryFlagSchema.parse(flag);
  const client = await createClient();
  const memberId = await myMembership(client, tripId);
  const { error } = await client.from("trip_constraints").delete()
    .eq("trip_id", tripId).eq("trip_member_id", memberId).eq("kind", "dietary").eq("flag", parsedFlag);
  if (error) databaseError(error);
}
