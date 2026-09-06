"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { submitBodySchema, type OnboardingSnapshot } from "@/lib/domain/onboarding";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
} from "@/lib/domain/constraints";

const tripIdSchema = z.string().uuid();

async function myMembership(client: Awaited<ReturnType<typeof createClient>>, tripId: string) {
  const user = await verifiedUser(client);
  const { data, error } = await client
    .from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  return data.id as string;
}

const KINDS = ["dietary", "religious_access", "mobility"] as const;
const FLAG_SCHEMA = {
  dietary: dietaryFlagSchema,
  religious_access: religiousAccessFlagSchema,
  mobility: mobilityFlagSchema,
} as const;

export async function getMyOnboarding(tripId: string): Promise<OnboardingSnapshot> {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  const memberId = await myMembership(client, tripId);

  const [{ data: profileRow, error: profileError }, { data: constraintRows, error: constraintError }] = await Promise.all([
    client.from("traveler_profiles")
      .select("travel_vibe,budget_lean,pace,social_role,serendipity_epsilon,mobility_threshold_m,onboarding_completed_at,profile_revision")
      .eq("trip_id", tripId).eq("trip_member_id", memberId).maybeSingle(),
    client.from("trip_constraints")
      .select("kind,flag,confirmed_at")
      .eq("trip_id", tripId).eq("trip_member_id", memberId).in("kind", [...KINDS]),
  ]);
  if (profileError) databaseError(profileError);
  if (constraintError) databaseError(constraintError);

  const dealbreakers = {
    dietary: { confirmed: [] as string[], pending: [] as string[] },
    religiousAccess: { confirmed: [] as string[], pending: [] as string[] },
    mobility: { confirmed: [] as string[], pending: [] as string[] },
  };
  const bucket = { dietary: "dietary", religious_access: "religiousAccess", mobility: "mobility" } as const;
  for (const row of constraintRows ?? []) {
    const kind = row.kind as (typeof KINDS)[number];
    const parsed = FLAG_SCHEMA[kind].safeParse(row.flag);
    if (!parsed.success) continue; // ignore an unknown flag rather than crash the wizard
    dealbreakers[bucket[kind]][row.confirmed_at ? "confirmed" : "pending"].push(parsed.data);
  }

  const profile = profileRow
    ? {
        travelVibe: profileRow.travel_vibe,
        budgetLean: profileRow.budget_lean,
        pace: profileRow.pace,
        socialRole: profileRow.social_role,
        serendipityEpsilon: Number(profileRow.serendipity_epsilon),
        mobilityThresholdM: profileRow.mobility_threshold_m,
        onboardingCompletedAt: profileRow.onboarding_completed_at,
      }
    : null;

  return {
    profile,
    profileRevision: profileRow ? Number(profileRow.profile_revision) : 0,
    dealbreakers: dealbreakers as OnboardingSnapshot["dealbreakers"],
    needsOnboarding: profile?.onboardingCompletedAt == null,
  };
}

export async function getOnboardingNeeded(tripId: string): Promise<boolean> {
  tripIdSchema.parse(tripId);
  const client = await createClient();
  await verifiedUser(client);
  // .limit(1) rather than .maybeSingle(): this runs on every dashboard GET, and a future
  // cross-member read policy must not turn a multi-row read into a 404 for the whole page.
  const { data, error } = await client
    .from("traveler_profiles").select("onboarding_completed_at").eq("trip_id", tripId).limit(1);
  if (error) databaseError(error);
  return !data || data.length === 0 || data[0].onboarding_completed_at == null;
}

function mapRpcError(error: { code?: string; message?: string }): AppError {
  if (error.code === "42501") return new AppError(403, "You are not a member of this trip.", "FORBIDDEN");
  if (error.code === "40001") {
    return new AppError(409, "Your preferences changed in another session. Reload to see the latest.", "STALE_PROFILE");
  }
  if (error.code === "P0001" && (error.message ?? "").includes("PENDING_CONSTRAINT_CONFLICT")) {
    return new AppError(409, "A pending suggestion exists for one of these dealbreakers; resolve it in constraint review first.", "PENDING_CONSTRAINT");
  }
  if (error.code === "22023") {
    return new AppError(422, "Some of the survey answers were invalid. Please review and resubmit.", "INVALID_ONBOARDING");
  }
  try { databaseError(error); } catch (mapped) { return mapped as AppError; }
  return new AppError(503, "Onboarding is temporarily unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export async function submitOnboarding(tripId: string, rawBody: unknown) {
  tripIdSchema.parse(tripId);
  const { expectedRevision, answers } = submitBodySchema.parse(rawBody);
  const client = await createClient();
  await verifiedUser(client);
  const { data, error } = await client.rpc("submit_onboarding", {
    p_trip_id: tripId,
    p_expected_revision: expectedRevision,
    p_answers: answers,
  });
  if (error) throw mapRpcError(error);
  return { profileRevision: Number(data), needsOnboarding: false as const };
}
