import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { databaseError } from "@/lib/http/errors";
import type { CuratedPoiRow } from "@/lib/poi/choice-pool";
import type { ProviderOpeningHours } from "@/lib/poi/opening-hours";

const timePointSchema = z.object({ day: z.number().int(), hour: z.number().int(), minute: z.number().int() });
const providerHoursSchema = z.object({
  periods: z.array(z.object({ open: timePointSchema, close: timePointSchema.nullish() })).nullish(),
}).nullable();

const rowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  latitude: z.coerce.number().nullable(),
  longitude: z.coerce.number().nullable(),
  tags: z.array(z.string()),
  cost_tier: z.string(),
  halal_status: z.enum(["verified", "claimed", "unknown", "no"]),
  allergen_risk: z.array(z.string()),
  allergen_data_unknown: z.boolean(),
  dress_code: z.enum(["none", "modest"]),
  short_description: z.string().nullable(),
  official_url: z.string().nullable(),
  source_url: z.string().nullable(),
  source_note: z.string().nullable(),
  verified_at: z.string().nullable(),
  provider_place_id: z.string().nullable(),
  business_status: z.enum(["operational", "closed_temporarily", "closed_permanently"]).nullable(),
  provider_hours: providerHoursSchema,
  provider_hours_fetched_at: z.string().nullable(),
  provider_hours_expires_at: z.string().nullable(),
});

const POOL_COLUMNS = "id,name,latitude,longitude,tags,cost_tier,halal_status,allergen_risk,allergen_data_unknown,"
  + "dress_code,short_description,official_url,source_url,source_note,verified_at,provider_place_id,"
  + "business_status,provider_hours,provider_hours_fetched_at,provider_hours_expires_at";

function mapRow(value: z.infer<typeof rowSchema>): CuratedPoiRow {
  return {
    id: value.id,
    name: value.name,
    latitude: value.latitude ?? 0,
    longitude: value.longitude ?? 0,
    tags: value.tags,
    costTier: value.cost_tier,
    halalStatus: value.halal_status,
    allergenRisk: value.allergen_risk,
    allergenDataUnknown: value.allergen_data_unknown,
    dressCode: value.dress_code,
    shortDescription: value.short_description,
    officialUrl: value.official_url,
    sourceUrl: value.source_url,
    sourceNote: value.source_note,
    verifiedAt: value.verified_at,
    providerPlaceId: value.provider_place_id,
    businessStatus: value.business_status,
    providerHours: (value.provider_hours ?? null) as ProviderOpeningHours | null,
    providerHoursFetchedAt: value.provider_hours_fetched_at,
    providerHoursExpiresAt: value.provider_hours_expires_at,
  };
}

/** One catalog row plus the region it belongs to, for server-side placement checks. */
export async function getPoiForScheduling(
  client: SupabaseClient, poiId: string,
): Promise<{ poi: CuratedPoiRow; region: string } | null> {
  const { data, error } = await client
    .from("poi_catalog").select(POOL_COLUMNS + ",region")
    .eq("id", poiId).maybeSingle();
  if (error) databaseError(error);
  if (!data) return null;
  const parsed = rowSchema.extend({ region: z.string() }).safeParse(data);
  if (!parsed.success) return null;
  return { poi: mapRow(parsed.data), region: parsed.data.region };
}

/**
 * Curated candidates for one reference-corridor region. Rows without coordinates are skipped rather
 * than defaulted to 0,0 -- the pool's duplicate resolver compares distances, and a fake origin
 * coordinate would silently merge unrelated venues.
 */
export async function listCuratedPoisForRegion(client: SupabaseClient, region: string): Promise<CuratedPoiRow[]> {
  const { data, error } = await client.from("poi_catalog").select(POOL_COLUMNS).eq("region", region).order("name");
  if (error) databaseError(error);
  const rows: CuratedPoiRow[] = [];
  for (const raw of data ?? []) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const value = parsed.data;
    if (value.latitude === null || value.longitude === null) continue;
    rows.push(mapRow(value));
  }
  return rows;
}
