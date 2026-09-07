"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import {
  memberEntrySchema, alignmentSummarySchema,
  type MemberEntry, type FlagRef, type AlignmentSummary,
} from "@/lib/domain/member-entry";
import { tripPreviewSchema, type TripPreview } from "@/lib/domain/trip-preview";

const tripIdSchema = z.string().uuid();

export type MemberEntryContext = {
  preview: TripPreview;
  savedSafety: FlagRef[];
  entry: MemberEntry | null;
  alignment: AlignmentSummary | null;
};

const flagRefRowSchema = z.object({
  kind: z.enum(["dietary", "religious_access", "mobility"]),
  flag: z.string().min(1),
});

function mapEntryRow(row: {
  availability_coverage: string;
  arrival_date: string | null;
  departure_date: string | null;
  budget_tier: string;
  pace: string;
  safety_overrides: unknown;
} | null): MemberEntry | null {
  if (!row) return null;
  return memberEntrySchema.parse({
    availability: {
      coverage: row.availability_coverage,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
    },
    budgetTier: row.budget_tier,
    pace: row.pace,
    safetyOverrides: Array.isArray(row.safety_overrides) ? row.safety_overrides : [],
  });
}

export async function getMyMemberEntryContext(tripId: string): Promise<MemberEntryContext> {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  const user = await verifiedUser(client);

  const [{ data: trip, error: tripError }, { data: memberRows, error: memberError }] = await Promise.all([
    client.from("trips")
      .select("id,destination_name,start_date,end_date,planned_duration_days,proposed_budget_tier,pace")
      .eq("id", tripId).maybeSingle(),
    client.from("trip_members").select("user_id,display_name,role").eq("trip_id", tripId),
  ]);
  if (tripError) databaseError(tripError);
  if (memberError) databaseError(memberError);
  const members = (memberRows ?? []) as Array<{ user_id: string | null; display_name: string; role: string }>;
  if (!trip || !members.some((member) => member.user_id === user.id)) {
    throw new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  }

  const organizer = members.find((member) => member.role === "owner");
  const tripRow = trip as {
    destination_name: string | null; start_date: string | null; end_date: string | null;
    planned_duration_days: number | null; proposed_budget_tier: string | null; pace: string | null;
  };
  const preview = tripPreviewSchema.parse({
    organizerName: organizer?.display_name ?? "The organizer",
    destinationName: tripRow.destination_name,
    startDate: tripRow.start_date,
    endDate: tripRow.end_date,
    plannedDurationDays: tripRow.planned_duration_days,
    memberCount: members.length,
    proposedBudgetTier: tripRow.proposed_budget_tier,
    pace: tripRow.pace ?? null,
  });

  const [
    { data: entryRow, error: entryError },
    { data: constraintRows, error: constraintError },
    { data: alignmentData, error: alignmentError },
  ] = await Promise.all([
    client.from("trip_member_entries")
      .select("availability_coverage,arrival_date,departure_date,budget_tier,pace,safety_overrides")
      .eq("trip_id", tripId).eq("user_id", user.id).maybeSingle(),
    client.from("user_travel_constraints")
      .select("kind,flag").is("retired_at", null).not("confirmed_at", "is", null),
    client.rpc("trip_alignment_summary", { p_trip_id: tripId }),
  ]);
  if (entryError) databaseError(entryError);
  if (constraintError) databaseError(constraintError);
  if (alignmentError) databaseError(alignmentError);

  const savedSafety = ((constraintRows ?? []) as unknown[])
    .map((row) => flagRefRowSchema.safeParse(row))
    .flatMap((result) => (result.success ? [result.data as FlagRef] : []));

  const alignment = alignmentData ? alignmentSummarySchema.parse(alignmentData) : null;

  return {
    preview,
    savedSafety,
    entry: mapEntryRow(entryRow as Parameters<typeof mapEntryRow>[0]),
    alignment,
  };
}

function mapRpcError(error: { code?: string }): AppError {
  if (error.code === "42501") return new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  if (error.code === "22023") {
    return new AppError(422, "Some of your trip answers were invalid. Please review and resubmit.", "INVALID_MEMBER_ENTRY");
  }
  try { databaseError(error); } catch (mapped) { return mapped as AppError; }
  return new AppError(503, "Trip entry is temporarily unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export async function submitMyMemberEntry(tripId: string, rawBody: unknown): Promise<{ ok: true }> {
  tripIdSchema.parse(tripId);
  const entry = memberEntrySchema.parse(rawBody);
  const client = await createClient();
  await verifiedUser(client);
  const { error } = await client.rpc("submit_member_entry", { p_trip_id: tripId, p_entry: entry });
  if (error) throw mapRpcError(error);
  return { ok: true };
}
