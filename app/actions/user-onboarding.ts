"use server";

import { createClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { submitBodySchema, type OnboardingSnapshot } from "@/lib/domain/onboarding";
import { isOnboardingComplete } from "@/lib/onboarding/gate";
import {
  dietaryFlagSchema, religiousAccessFlagSchema, mobilityFlagSchema,
} from "@/lib/domain/constraints";

const KINDS = ["dietary", "religious_access", "mobility"] as const;
const FLAG_SCHEMA = {
  dietary: dietaryFlagSchema,
  religious_access: religiousAccessFlagSchema,
  mobility: mobilityFlagSchema,
} as const;
const BUCKET = { dietary: "dietary", religious_access: "religiousAccess", mobility: "mobility" } as const;

export async function getMyUserOnboarding(): Promise<OnboardingSnapshot> {
  const client = await createClient();
  await verifiedUser(client);

  const [{ data: profileRow, error: profileError }, { data: constraintRows, error: constraintError }] = await Promise.all([
    client.from("user_travel_profiles")
      .select("travel_vibe,serendipity_epsilon,onboarding_completed_at,profile_revision")
      .maybeSingle(),
    client.from("user_travel_constraints")
      .select("kind,flag,confirmed_at")
      .is("retired_at", null).in("kind", [...KINDS]),
  ]);
  if (profileError) databaseError(profileError);
  if (constraintError) databaseError(constraintError);

  const dealbreakers = {
    dietary: { confirmed: [] as string[], pending: [] as string[] },
    religiousAccess: { confirmed: [] as string[], pending: [] as string[] },
    mobility: { confirmed: [] as string[], pending: [] as string[] },
  };
  for (const row of constraintRows ?? []) {
    const kind = row.kind as (typeof KINDS)[number];
    const parsed = FLAG_SCHEMA[kind]?.safeParse(row.flag);
    if (!parsed?.success) continue; // ignore an unknown flag rather than crash the wizard
    dealbreakers[BUCKET[kind]][row.confirmed_at ? "confirmed" : "pending"].push(parsed.data);
  }

  const profile = profileRow
    ? {
        travelVibe: profileRow.travel_vibe,
        serendipityEpsilon: Number(profileRow.serendipity_epsilon),
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

export async function getUserOnboardingComplete(): Promise<boolean> {
  const client = await createClient();
  await verifiedUser(client);
  return isOnboardingComplete(client);
}

function mapUserRpcError(error: { code?: string; message?: string }): AppError {
  if (error.code === "42501") return new AppError(401, "Please sign in to continue.", "UNAUTHENTICATED");
  if (error.code === "40001") {
    return new AppError(409, "Your preferences changed in another session. Reload to see the latest.", "STALE_PROFILE");
  }
  if (error.code === "22023") {
    return new AppError(422, "Some of your answers were invalid. Please review and resubmit.", "INVALID_ONBOARDING");
  }
  try { databaseError(error); } catch (mapped) { return mapped as AppError; }
  return new AppError(503, "Onboarding is temporarily unavailable. Please try again.", "STORAGE_UNAVAILABLE");
}

export async function submitUserOnboarding(rawBody: unknown) {
  const { expectedRevision, answers } = submitBodySchema.parse(rawBody);
  const client = await createClient();
  await verifiedUser(client);
  const { data, error } = await client.rpc("submit_user_onboarding", {
    p_expected_revision: expectedRevision,
    p_answers: answers,
  });
  if (error) throw mapUserRpcError(error);
  return { profileRevision: Number(data), needsOnboarding: false as const };
}
