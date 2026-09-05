#!/usr/bin/env node
// Implementation_Plan.md Task 1.1: deterministic, idempotent seed for the reference-corridor
// poi_catalog rows (KLCC, Bukit Bintang, Old Town/Melaka). Commercial map APIs do not carry
// halal_status/allergen_risk/dress_code/landmark_class, so this is the ground truth every
// downstream safety feature (the Section VII hard-constraint gate, packing, VQA) reads.
//
// Every row must carry its provenance (sourceUrl, sourceNote, verifiedAt) and must mark
// allergenDataUnknown honestly -- never infer safety from cuisine type, reviews, or the absence
// of a warning. See docs/research/kl-reference-poi-review.md for the sourcing methodology and
// per-record review notes before any row here is treated as production-verified.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... npm run seed:kl-reference (loads NEXT_PUBLIC_SUPABASE_URL
// from .env via --env-file; the service-role key is never read from .env, matching
// scripts/create-dev-user.mjs's convention).

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not set. Run via `npm run seed:kl-reference` (it loads .env).");
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set. Get it from Supabase -> Project Settings -> API -> service_role, then set it for this command only -- never put it in .env or .env.local.");
  process.exit(1);
}

const poiSchema = z.object({
  name: z.string().min(1).max(200),
  region: z.enum(["KLCC", "Bukit Bintang", "Old Town/Melaka"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  costTier: z.enum(["free", "budget", "standard", "premium", "luxury"]),
  tags: z.array(z.string()),
  halalStatus: z.enum(["verified", "claimed", "unknown", "no"]),
  allergenRisk: z.array(z.string()),
  allergenDataUnknown: z.boolean(),
  indoor: z.boolean(),
  dressCode: z.enum(["none", "modest"]),
  touristDensity: z.enum(["low", "medium", "high"]),
  heightM: z.number().min(0).nullable(),
  landmarkClass: z.enum(["prominent_structure", "global_storefront", "architectural_typology"]).nullable(),
  sourceUrl: z.string().url(),
  sourceNote: z.string().min(1),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "verifiedAt must be YYYY-MM-DD"),
});
type PoiSeedRow = z.infer<typeof poiSchema>;

// Populated from docs/research/kl-reference-poi-review.md once each record is source-verified.
// Every entry must be traceable to sourceUrl; nothing here may be a plausible-sounding guess.
// 22 of the target 40-50 (see that file's "Next steps" section for how to extend).
const NOT_A_FOOD_POI: Pick<PoiSeedRow, "halalStatus" | "allergenRisk" | "allergenDataUnknown"> = {
  halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: true,
};

const REFERENCE_POIS: PoiSeedRow[] = [
  // --- KLCC ---
  {
    name: "Petronas Twin Towers", region: "KLCC", lat: 3.1578, lng: 101.7117,
    costTier: "premium", tags: ["landmark", "architecture", "viewpoint"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: 451.9, landmarkClass: "prominent_structure",
    sourceUrl: "https://en.wikipedia.org/wiki/Petronas_Towers", sourceNote: "Wikipedia infobox height/coordinates; official petronastwintowers.com.my for visitor context.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "KLCC Park", region: "KLCC", lat: 3.155647, lng: 101.714997,
    costTier: "free", tags: ["park", "nature", "family"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://en.wikipedia.org/wiki/KLCC_Park", sourceNote: "Wikipedia infobox coordinates.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Aquaria KLCC", region: "KLCC", lat: 3.1533927, lng: 101.713078,
    costTier: "standard", tags: ["family", "aquarium", "indoor"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "medium", heightM: null, landmarkClass: null,
    sourceUrl: "https://en.wikipedia.org/wiki/Aquaria_KLCC", sourceNote: "Wikipedia infobox coordinates; official aquariaklcc.com for address.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Suria KLCC", region: "KLCC", lat: 3.155647, lng: 101.714997,
    costTier: "standard", tags: ["shopping", "mall", "food"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://en.wikipedia.org/wiki/Suria_KLCC",
    sourceNote: "No standalone mall coordinate published; using the shared KLCC Park complex coordinate (Suria KLCC sits at the tower base on the same site).",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Avenue K", region: "KLCC", lat: 3.15955, lng: 101.71344,
    costTier: "standard", tags: ["shopping", "mall"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "medium", heightM: null, landmarkClass: null,
    sourceUrl: "https://www.avenuek.com.my/getting-here/", sourceNote: "Official site address/coordinates (156 Jalan Ampang, opposite Petronas Twin Towers, linked to KLCC LRT).",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Troika Sky Dining", region: "KLCC", lat: 3.15466, lng: 101.71797,
    costTier: "premium", tags: ["food", "fine_dining", "rooftop"],
    halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: true,
    indoor: true, dressCode: "none", touristDensity: "medium", heightM: null, landmarkClass: null,
    sourceUrl: "https://troikaskydining.com/",
    sourceNote: "Secondary sources describe staff accommodating halal requests and occasional halal-themed events -- not the same as JAKIM certification or a venue self-declaration, so recorded unknown rather than claimed.",
    verifiedAt: "2026-09-05",
  },
  // --- Bukit Bintang ---
  {
    name: "KL Tower", region: "Bukit Bintang", lat: 3.1528, lng: 101.7038,
    costTier: "premium", tags: ["landmark", "viewpoint", "tower"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: 421, landmarkClass: "prominent_structure",
    sourceUrl: "https://en.wikipedia.org/wiki/Kuala_Lumpur_Tower", sourceNote: "Wikipedia infobox height; official kltower.com.my for address (No. 2 Jalan Punchak, off Jalan P. Ramlee).",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Pavilion Kuala Lumpur", region: "Bukit Bintang", lat: 3.149215, lng: 101.713529,
    costTier: "standard", tags: ["shopping", "mall", "food"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://en.wikipedia.org/wiki/Pavilion_Kuala_Lumpur", sourceNote: "Wikipedia infobox address/coordinates (168 Jalan Bukit Bintang).",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Jalan Alor", region: "Bukit Bintang", lat: 3.145872, lng: 101.708909,
    costTier: "budget", tags: ["food", "street_food", "night_market"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://www.wonderfulmalaysia.com/food/jalan-alor-food-street.htm",
    sourceNote: "Mixed street of ~200 independent stalls/restaurants -- halal_status deliberately left unknown; no single certification covers the street, and individual stalls vary.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "OldTown White Coffee (Pavilion KL)", region: "Bukit Bintang", lat: 3.149215, lng: 101.713529,
    costTier: "standard", tags: ["food", "cafe", "halal_certified"],
    halalStatus: "verified", allergenRisk: [], allergenDataUnknown: true,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://www.facebook.com/HabHalalJakim/photos/a.744506395708636/1775823102576955/?type=3",
    sourceNote: "JAKIM Halal Hub's own statement confirms SPHM certification chain-wide; The Star (2013) independently reported the certification. Outlet address: Lot 1.30.00, Level 1, Pavilion KL. No allergen disclosure found.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Fahrenheit 88", region: "Bukit Bintang", lat: 3.1475, lng: 101.7125,
    costTier: "standard", tags: ["shopping", "mall"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://en.wikipedia.org/wiki/Fahrenheit_88", sourceNote: "Wikipedia infobox address/coordinates (179 Jalan Bukit Bintang / Jalan Gading).",
    verifiedAt: "2026-09-05",
  },
  // --- Old Town / Melaka ---
  {
    name: "A Famosa", region: "Old Town/Melaka", lat: 2.1916167, lng: 102.2503056,
    costTier: "free", tags: ["heritage", "unesco", "fort"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://en.wikipedia.org/wiki/A_Famosa", sourceNote: "Wikipedia infobox coordinates; UNESCO World Heritage core-zone inscription 2008.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Christ Church Melaka", region: "Old Town/Melaka", lat: 2.1936, lng: 102.2504,
    costTier: "free", tags: ["heritage", "unesco", "church"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://evendo.com/locations/malaysia/malacca/attraction/christ-church-melaka",
    sourceNote: "Located on Jalan Gereja, Dutch Square; coordinate approximated from the Dutch Square cluster (Stadthuys sits immediately beside it) since no independent infobox coordinate was found for this specific building. dressCode left 'none': no source found for an enforced dress policy at this specific church, unlike the temple entry below.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Stadthuys", region: "Old Town/Melaka", lat: 2.194059, lng: 102.249154,
    costTier: "free", tags: ["heritage", "unesco", "museum"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://en.wikipedia.org/wiki/Stadthuys", sourceNote: "Wikipedia infobox coordinates. Oldest Dutch building in the East (1641-1660).",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Cheng Hoon Teng Temple", region: "Old Town/Melaka", lat: 2.197472, lng: 102.246861,
    costTier: "free", tags: ["heritage", "temple", "unesco"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "modest", touristDensity: "medium", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://en.wikipedia.org/wiki/Cheng_Hoon_Teng_Temple",
    sourceNote: "Oldest continuously operating Chinese temple in Malaysia (founded 1645), 25 Jalan Tokong. dressCode 'modest' applied per Implementation_Plan.md's own named category (mosques and temples), not a venue-specific policy citation.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Jonker Street", region: "Old Town/Melaka", lat: 2.195033, lng: 102.248248,
    costTier: "budget", tags: ["heritage", "shopping", "street_food", "night_market"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://thesmartlocal.my/jonker-street-melaka/",
    sourceNote: "Melaka's Chinatown heritage spine (Jalan Hang Jebat), UNESCO core zone. Mixed shops/eateries -- halal_status deliberately left unknown, same reasoning as Jalan Alor.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Menara Taming Sari", region: "Old Town/Melaka", lat: 2.190833, lng: 102.247111,
    costTier: "standard", tags: ["landmark", "viewpoint", "tower"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: "prominent_structure",
    sourceUrl: "https://en.wikipedia.org/wiki/Taming_Sari_Tower",
    sourceNote: "Wikipedia infobox coordinates; official menaratamingsari.com for address (Plaza Mahkota). Revolving gyro tower; height not independently found so left null rather than estimated.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "St Paul's Church (ruins)", region: "Old Town/Melaka", lat: 2.192616, lng: 102.249585,
    costTier: "free", tags: ["heritage", "unesco", "ruins", "viewpoint"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://www.travelfish.org/sight_profile/malaysia/peninsular_malaysia/melaka/melaka/1549",
    sourceNote: "Roofless 1521 Portuguese-era church ruin atop St Paul's Hill. Free, open 24 hours.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Kampung Kling Mosque", region: "Old Town/Melaka", lat: 2.19667, lng: 102.24750,
    costTier: "free", tags: ["heritage", "mosque", "unesco"], ...NOT_A_FOOD_POI,
    indoor: false, dressCode: "modest", touristDensity: "medium", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://en.wikipedia.org/wiki/Kampung_Kling_Mosque",
    sourceNote: "Founded 1748, one of the oldest mosques on the Malay Peninsula, Jalan Tukang Emas. dressCode 'modest' is the clearest-cut of this batch's dress-code calls -- 'mosque' is explicitly named in Implementation_Plan.md's own example, not inferred.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Baba & Nyonya Heritage Museum", region: "Old Town/Melaka", lat: 2.19528, lng: 102.24667,
    costTier: "standard", tags: ["heritage", "museum", "peranakan"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "medium", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://www.babanyonyamuseum.com/",
    sourceNote: "Official site address/contact (48-50 Jalan Tun Tan Cheng Lock); Wikipedia for coordinates and founding year (1986).",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Melaka Sultanate Palace Museum", region: "Old Town/Melaka", lat: 2.1929, lng: 102.2504,
    costTier: "standard", tags: ["heritage", "museum", "palace"], ...NOT_A_FOOD_POI,
    indoor: true, dressCode: "none", touristDensity: "medium", heightM: null, landmarkClass: "architectural_typology",
    sourceUrl: "https://en.wikipedia.org/wiki/Malacca_Sultanate_Palace_Museum",
    sourceNote: "Reconstruction of the Malacca Sultanate-era palace at the foot of St Paul's Hill, opened 1986. Kompleks Warisan Melaka, Jalan Kota.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Nancy's Kitchen", region: "Old Town/Melaka", lat: 2.195033, lng: 102.248248,
    costTier: "standard", tags: ["food", "peranakan", "nyonya"],
    halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: true,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://therantingpanda.com/2019/05/25/food-review-nancys-kitchen-restaurant-in-melaka-malaysia-one-of-the-most-popular-peranakan-restaurant-in-the-city/",
    sourceNote: "Multiple secondary travel-blog sources describe this as a traditional pork-serving Peranakan restaurant, and one aggregator (airial.travel) labels it 'Non Halal', but none traces to an official halal-authority statement or the venue's own declaration -- recorded as unknown, not 'no', per instruction not to infer from cuisine type or secondary claims. Coordinate approximated to Jonker Street (mid-way along it per sources); no independent building-level coordinate found.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "Seri Nyonya Restaurant (Hotel Equatorial Melaka)", region: "Old Town/Melaka", lat: 2.194059, lng: 102.249154,
    costTier: "premium", tags: ["food", "peranakan", "nyonya", "halal_claimed"],
    halalStatus: "claimed", allergenRisk: [], allergenDataUnknown: true,
    indoor: true, dressCode: "none", touristDensity: "medium", heightM: null, landmarkClass: null,
    sourceUrl: "https://rebeccasaw.com/halal-nyonya-food-in-melaka-seri-nyonya-hotel-equatorial-melaka/",
    sourceNote: "Multiple independent food-blog sources (Rebecca Saw, elanakhong.com, Burpple) consistently describe this as halal-certified/pork-free, calling it the only halal-certified Nyonya restaurant in Melaka -- more corroborated than a single claim, but no JAKIM directory listing or official statement found, so halalStatus stays 'claimed' not 'verified'. Coordinate approximated to the Stadthuys/Dutch Square cluster (~500m/6-min walk per sources); no independent building-level coordinate found.",
    verifiedAt: "2026-09-05",
  },
  {
    name: "The Daily Fix", region: "Old Town/Melaka", lat: 2.196307, lng: 102.246768,
    costTier: "standard", tags: ["food", "cafe", "halal_claimed"],
    halalStatus: "claimed", allergenRisk: [], allergenDataUnknown: true,
    indoor: true, dressCode: "none", touristDensity: "high", heightM: null, landmarkClass: null,
    sourceUrl: "https://sgmytrips.com/halal-food-in-melaka/",
    sourceNote: "Independently described as a halal-certified cafe by multiple unofficial travel sources (SGMYTRIPS, Klook, Holidify, Rucksackinn, Tours-Malaysia) with no contradicting claim found, consistent enough for 'claimed'; none of these is JAKIM's own directory or an official statement, so not 'verified'. Address 55 Jalan Hang Jebat (Jonker Street); coordinates per Wanderlog's place listing for that address.",
    verifiedAt: "2026-09-05",
  },
];

async function main() {
  const parsed = REFERENCE_POIS.map((row) => poiSchema.parse(row));
  if (parsed.length === 0) {
    console.error("REFERENCE_POIS is empty -- populate it from the sourced research review before seeding.");
    process.exit(1);
  }
  // service_role bypasses RLS (see the "bypassrls" role in every migration's role setup), so a
  // plain upsert is sufficient -- no custom RPC needed. geog is written via a raw SQL cast since
  // PostgREST's schema cache does not accept a geography literal through .upsert() directly.
  const admin = createClient(url!, serviceRoleKey!, { auth: { autoRefreshToken: false, persistSession: false } });
  let upserted = 0;
  for (const poi of parsed) {
    const { error } = await admin.from("poi_catalog").upsert({
      name: poi.name, region: poi.region,
      geog: `SRID=4326;POINT(${poi.lng} ${poi.lat})`,
      cost_tier: poi.costTier, tags: poi.tags, halal_status: poi.halalStatus,
      allergen_risk: poi.allergenRisk, allergen_data_unknown: poi.allergenDataUnknown,
      indoor: poi.indoor, dress_code: poi.dressCode, tourist_density: poi.touristDensity,
      height_m: poi.heightM, landmark_class: poi.landmarkClass,
      source_url: poi.sourceUrl, source_note: poi.sourceNote, verified_at: poi.verifiedAt,
    }, { onConflict: "name,region" });
    if (error) { console.error(`Failed to upsert ${poi.name}: ${error.message}`); process.exit(1); }
    upserted += 1;
  }
  console.log(`Seeded ${upserted} reference POI row(s).`);
}

void main();
