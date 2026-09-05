import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { budgetTierSchema, calendarDateSchema, paceLevelSchema, tripInputSchema, type TripInput } from "@/lib/domain/trip";
import { verifiedUser } from "@/lib/supabase/auth";
import { AppError, databaseError } from "@/lib/http/errors";
import { geminiTripProposalSchema } from "@/lib/gemini/schemas";
import type { GeminiTripProposal } from "@/lib/gemini/types";
import type { ConfirmedConstraintFlag, TravelerCapRow } from "@/lib/domain/constraint-gate";
import type { CandidatePoi, PoiCatalogRegion } from "@/lib/domain/poi-resolution";
import type { TripRecord, ProposalRecord, TripRepository } from "./planning-repository";

const tripColumns = "id,owner_user_id,destination_name,start_date,end_date,budget_tier,pace,notes,revision,active_proposal_id";
const proposalColumns = "id,trip_id,status,payload,model_identifier,created_at,expires_at,trip_revision";
const roleSchema = z.enum(["owner", "planner", "member", "viewer"]);

const confirmedConstraintRowSchema = z.object({
  kind: z.enum(["dietary", "religious_access", "mobility"]),
  flag: z.string(),
  severity: z.enum(["severe", "standard"]),
});

const travelerCapRowSchema = z.object({
  trip_member_id: z.string().uuid(),
  budget_daily_cap: z.coerce.number().nullable(),
  budget_total_cap: z.coerce.number().nullable(),
  mobility_threshold_m: z.number().int().nullable(),
});

const candidatePoiRowSchema = z.object({
  name: z.string(),
  halal_status: z.enum(["verified", "claimed", "unknown", "no"]),
  allergen_risk: z.array(z.string()),
  allergen_data_unknown: z.boolean(),
  dress_code: z.enum(["none", "modest"]),
});

// Read historical rows without applying today's input limits, so owners can repair them.
const persistedTripSchema = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().min(1),
  destination_name: z.string().min(1),
  start_date: calendarDateSchema,
  end_date: calendarDateSchema,
  budget_tier: budgetTierSchema,
  pace: paceLevelSchema,
  notes: z.string().nullish(),
  revision: z.number().int().positive(),
  active_proposal_id: z.string().uuid().nullable(),
}).refine((row) => row.end_date >= row.start_date);

function storedValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(503, "Trip storage is unavailable. Please try again.", "STORAGE_UNAVAILABLE");
  return result.data;
}

function fields(input: TripInput) {
  return {
    destination_name: input.destinationName, start_date: input.startDate, end_date: input.endDate,
    budget_tier: input.budgetTier, pace: input.pace, notes: input.notes ?? null,
  };
}

function mapTrip(row: Record<string, unknown>, role: TripRecord["role"]): TripRecord {
  const value = storedValue(persistedTripSchema, row);
  return {
    id: value.id, ownerUserId: value.owner_user_id, role, revision: value.revision,
    activeProposalId: value.active_proposal_id, destinationName: value.destination_name,
    startDate: value.start_date, endDate: value.end_date, budgetTier: value.budget_tier,
    pace: value.pace, notes: value.notes ?? undefined,
  };
}

function mapProposal(row: Record<string, unknown>): ProposalRecord {
  const expiresAt = z.string().parse(row.expires_at);
  let status = z.enum(["pending", "accepted", "rejected", "expired"]).parse(row.status);
  if (status === "pending" && Date.parse(expiresAt) <= Date.now()) status = "expired";
  return { id: z.string().uuid().parse(row.id), tripId: z.string().uuid().parse(row.trip_id), status,
    payload: geminiTripProposalSchema.parse(row.payload), model: z.string().parse(row.model_identifier),
    createdAt: z.string().parse(row.created_at), expiresAt, tripRevision: z.coerce.number().int().positive().parse(row.trip_revision) };
}

export class SupabaseTripRepository implements TripRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async userId(): Promise<string> {
    return (await verifiedUser(this.client)).id;
  }

  private async membership(tripId: string, userId: string) {
    const { data, error } = await this.client.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new AppError(404, "Trip not found.", "NOT_FOUND");
    return storedValue(roleSchema, data.role);
  }

  async createTrip(input: TripInput): Promise<TripRecord> {
    const owner = await this.userId();
    const parsed = tripInputSchema.parse(input);
    const { data, error } = await this.client.from("trips").insert({ ...fields(parsed), name: parsed.destinationName, owner_user_id: owner }).select(tripColumns).single();
    if (error) databaseError(error);
    if (!data) throw new AppError(503, "The trip could not be saved.");
    return mapTrip(data, "owner");
  }

  async getTrip(tripId: string): Promise<TripRecord> {
    const userId = await this.userId();
    z.string().uuid().parse(tripId);
    const { data, error } = await this.client.from("trips").select(tripColumns).eq("id", tripId).maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new AppError(404, "Trip not found.", "NOT_FOUND");
    return mapTrip(data, await this.membership(tripId, userId));
  }

  async listTrips(): Promise<TripRecord[]> {
    const userId = await this.userId();
    const { data, error } = await this.client.from("trips").select(tripColumns).order("updated_at", { ascending: false });
    if (error) databaseError(error);
    return Promise.all((data ?? []).map(async (row) => mapTrip(row, await this.membership(row.id, userId))));
  }

  async updateTrip(tripId: string, input: TripInput): Promise<TripRecord> {
    const trip = await this.getTrip(tripId);
    if (trip.role !== "owner" && trip.role !== "planner") throw new AppError(403, "Only the owner or a planner can edit this trip.", "FORBIDDEN");
    const parsed = tripInputSchema.parse(input);
    const { data, error } = await this.client.from("trips").update(fields(parsed)).eq("id", tripId).select(tripColumns).single();
    if (error) databaseError(error);
    return mapTrip(data, trip.role);
  }

  async listProposals(tripId: string): Promise<ProposalRecord[]> {
    await this.getTrip(tripId);
    const { data, error } = await this.client.from("agent_proposals").select(proposalColumns).eq("trip_id", tripId).eq("proposal_type", "gemini_itinerary").order("created_at", { ascending: false });
    if (error) databaseError(error);
    return (data ?? []).map(mapProposal);
  }

  async reserveGeneration(tripId: string): Promise<void> {
    await this.userId();
    const { error } = await this.client.rpc("reserve_generation", { target_trip_id: tripId });
    if (error) databaseError(error);
  }

  async listConfirmedConstraints(tripId: string): Promise<ConfirmedConstraintFlag[]> {
    await this.userId();
    const { data, error } = await this.client
      .from("confirmed_trip_constraints").select("kind,flag,severity").eq("trip_id", tripId);
    if (error) databaseError(error);
    return (data ?? []).map((row) => confirmedConstraintRowSchema.parse(row));
  }

  async listTravelerCaps(tripId: string): Promise<TravelerCapRow[]> {
    await this.userId();
    const { data, error } = await this.client.rpc("trip_member_budget_mobility_caps", { target_trip_id: tripId });
    if (error) databaseError(error);
    return ((data ?? []) as unknown[]).map((row) => {
      const value = travelerCapRowSchema.parse(row);
      return { tripMemberId: value.trip_member_id, budgetDailyCap: value.budget_daily_cap, budgetTotalCap: value.budget_total_cap, mobilityThresholdM: value.mobility_threshold_m };
    });
  }

  async listPoisByRegion(region: PoiCatalogRegion): Promise<CandidatePoi[]> {
    await this.userId();
    const { data, error } = await this.client
      .from("poi_catalog").select("name,halal_status,allergen_risk,allergen_data_unknown,dress_code")
      .eq("region", region).contains("tags", ["food"]).limit(50);
    if (error) databaseError(error);
    return (data ?? []).map((row) => {
      const value = candidatePoiRowSchema.parse(row);
      return { name: value.name, halalStatus: value.halal_status, allergenRisk: value.allergen_risk, allergenDataUnknown: value.allergen_data_unknown, dressCode: value.dress_code };
    });
  }

  async saveProposal(trip: TripRecord, payload: GeminiTripProposal, model: string): Promise<ProposalRecord> {
    await this.userId();
    const { data, error } = await this.client.rpc("save_trip_proposal", { target_trip_id: trip.id, expected_revision: trip.revision, proposal_payload: geminiTripProposalSchema.parse(payload), model_identifier: model });
    if (error) databaseError(error);
    return mapProposal(Array.isArray(data) ? data[0] : data);
  }

  async decideProposal(tripId: string, proposalId: string, decision: "accept" | "reject"): Promise<ProposalRecord> {
    await this.userId();
    z.string().uuid().parse(tripId);
    z.string().uuid().parse(proposalId);
    z.enum(["accept", "reject"]).parse(decision);
    const { data, error } = await this.client.rpc("decide_trip_proposal", { target_trip_id: tripId, target_proposal_id: proposalId, decision });
    if (error) databaseError(error);
    return mapProposal(Array.isArray(data) ? data[0] : data);
  }
}
