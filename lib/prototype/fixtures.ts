import type { ChatHomeTrip } from "@/lib/domain/chat-home";
import type { ChatMessage } from "@/lib/chat/repository";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";

/**
 * Every value the prototype renders. Nothing here is a runtime default: it is reachable only
 * through the `isPrototype()` branches in the route files. Edits made in the browser live in
 * React state and are gone on refresh -- see the "Demo mode" banner in AppShell.
 */

// A FIXED instant, not `Date.now()`. The fixtures module is evaluated once on the server and
// again in the browser; anything derived from the wall clock would differ between the two and
// break hydration. Every timestamp below is a deterministic offset from this literal.
const DEMO_NOW = Date.parse("2026-09-08T14:00:00.000Z");

function iso(minutesFromNow: number): string {
  return new Date(DEMO_NOW + minutesFromNow * 60_000).toISOString();
}

/** A syntactically valid UUID so the `/trips/[tripId]` layout's `z.string().uuid()` gate passes. */
export const DEMO_TRIP_ID = "0a7e1d90-4b2c-4f11-8b6a-9c1d2e3f4a5b";
export const DEMO_PROPOSAL_ID = "9f3b2a10-0000-4000-8000-00000000c0de";

export const DEMO_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "demo@waypoint.app",
  displayName: "You",
} as const;

export const DEMO_MEMBERS: readonly JigsawMember[] = [
  { id: DEMO_USER.id, displayName: "You", color: "#e07a5f" },
  { id: "22222222-2222-4222-8222-222222222222", displayName: "Mei", color: "#3d9a8b" },
  { id: "33333333-3333-4333-8333-333333333333", displayName: "Arun", color: "#7b6cc4" },
];
export const DEMO_SELF_MEMBER_ID = DEMO_USER.id;
const MEI = DEMO_MEMBERS[1].id;
const ARUN = DEMO_MEMBERS[2].id;

function msg(
  id: string,
  authorMemberId: string | null,
  authorKind: ChatMessage["authorKind"],
  body: string,
  minutesFromNow: number,
  proposalId: string | null = null,
): ChatMessage {
  return { id, tripId: DEMO_TRIP_ID, authorMemberId, authorKind, body, proposalId, createdAt: iso(minutesFromNow) };
}

export const DEMO_TRIP = {
  id: DEMO_TRIP_ID,
  name: "George Town long weekend",
  status: "ready" as const,
  destinationName: "George Town, Penang",
  startDate: "2026-10-03",
  endDate: "2026-10-05",
  revision: 4,
  role: "owner" as const,
  organizerName: "You",
  memberCount: 3,
  proposedBudgetTier: "standard" as const,
  pace: "balanced" as const,
};

export const DEMO_TRIP_DATES = ["2026-10-03", "2026-10-04", "2026-10-05"];

export const DEMO_CHAT_HOME_TRIPS: ChatHomeTrip[] = [
  {
    id: DEMO_TRIP_ID,
    name: DEMO_TRIP.name,
    status: "ready",
    destinationName: DEMO_TRIP.destinationName,
    startDate: DEMO_TRIP.startDate,
    endDate: DEMO_TRIP.endDate,
    tripMode: "balanced",
    plannedDurationDays: null,
    proposedBudgetTier: "standard",
    memberCount: DEMO_MEMBERS.length,
    latestMessage: { preview: "Arun: heads up, I can't do shellfish at all", at: iso(-40) },
    memberAvatars: DEMO_MEMBERS.map((member) => ({ id: member.id, displayName: member.displayName, color: member.color })),
    unread: null,
  },
  {
    id: "0a7e1d90-4b2c-4f11-8b6a-9c1d2e3f4a5c",
    name: "Melaka food crawl (draft)",
    status: "draft",
    destinationName: "Melaka",
    startDate: null,
    endDate: null,
    tripMode: "relaxed",
    plannedDurationDays: 2,
    proposedBudgetTier: "budget",
    memberCount: 2,
    latestMessage: null,
    memberAvatars: DEMO_MEMBERS.slice(0, 2).map((m) => ({ id: m.id, displayName: m.displayName, color: m.color })),
    unread: null,
  },
];

/** Oldest first, matching `listMessages(...).reverse()`. */
export const DEMO_CHAT_MESSAGES: ChatMessage[] = [
  msg("m1", MEI, "member", "Landing Friday around noon — does the plan still start at George Town?", -230),
  msg("m2", DEMO_USER.id, "member", "Yep. Thinking Street of Harmony first, then hawker lunch.", -228),
  msg("m3", ARUN, "member", "Works for me. I'd love a jazz bar one evening if there's one nearby", -140),
  msg("m4", MEI, "member", "Rain forecast for Saturday afternoon btw", -120),
  msg("m5", DEMO_USER.id, "member", "@assistant can you draft a 3-day itinerary for George Town?", -90),
  msg("m6", null, "assistant",
    "I've drafted a 3-day itinerary for George Town — it keeps Saturday afternoon indoors and holds the jazz bar as an evening option. Open the Plan tab to review and confirm it.",
    -88),
  msg("m7", ARUN, "member", "Nice. Also — heads up, I can't do shellfish at all", -40),
];

export const DEMO_PROPOSAL: ProposalRecord = {
  id: DEMO_PROPOSAL_ID,
  tripId: DEMO_TRIP_ID,
  status: "pending",
  model: "prototype-fixture",
  createdAt: iso(-88),
  expiresAt: iso(60 * 48),
  tripRevision: DEMO_TRIP.revision,
  payload: {
    summary:
      "Three days in George Town at a balanced pace. Heritage and food on foot in the core, a wet-weather indoor block on Saturday, and Penang Hill kept for the clearest morning. Shellfish is avoided in every listed food stop.",
    activities: [
      {
        title: "Street of Harmony walk", category: "culture", date: "2026-10-03", startTime: "09:30",
        durationMinutes: 120, estimatedCostTier: "budget",
        rationale: "Mosque, temples and church on one street — an easy orientation to the old town.",
        contingencyNote: "Dress modestly for the mosque; it closes to visitors at prayer times.",
      },
      {
        title: "Hawker lunch at Chulia Street", category: "food", date: "2026-10-03", startTime: "12:00",
        durationMinutes: 75, estimatedCostTier: "budget",
        rationale: "Char kway teow and duck egg options; stalls confirmed to have non-shellfish plates.",
        contingencyNote: "Peak queue 12:30–13:00; go early or shift 30 minutes.",
      },
      {
        title: "Clan Jetties + Armenian Street", category: "culture", date: "2026-10-03", startTime: "15:00",
        durationMinutes: 120, estimatedCostTier: "budget",
        rationale: "Waterfront stilt village and the street-art core, both walkable from lunch.",
        contingencyNote: null,
      },
      {
        title: "Peranakan Mansion", category: "culture", date: "2026-10-04", startTime: "10:00",
        durationMinutes: 90, estimatedCostTier: "standard",
        rationale: "Indoor and covered — the wet-weather anchor for the day.",
        contingencyNote: "Guided entry only; last tour 15:30.",
      },
      {
        title: "Tea + kaya toast, Campbell House", category: "food", date: "2026-10-04", startTime: "15:30",
        durationMinutes: 60, estimatedCostTier: "standard",
        rationale: "Sit-down indoor stop to wait out the forecast afternoon rain.",
        contingencyNote: null,
      },
      {
        title: "Jazz at a Love Lane bar (optional)", category: "culture", date: "2026-10-04", startTime: "21:00",
        durationMinutes: 120, estimatedCostTier: "standard",
        rationale: "Held as an option for Arun; not locked so the evening stays flexible.",
        contingencyNote: "Live set only on weekends — confirm on arrival.",
      },
      {
        title: "Penang Hill early ascent", category: "nature", date: "2026-10-05", startTime: "08:00",
        durationMinutes: 180, estimatedCostTier: "standard",
        rationale: "Best light and shortest funicular queue before 09:00; clearest-morning slot.",
        contingencyNote: "If low cloud, swap for the Botanic Gardens loop.",
      },
    ],
    assumptions: [
      "Group arrives Friday around noon and departs Sunday evening.",
      "One traveller cannot eat shellfish — treated as a hard constraint for every food stop.",
      "Saturday afternoon rain is likely; the day is planned indoors.",
      "Walking distances within the core are acceptable to everyone (under 1.5 km per leg).",
    ],
  },
};

// --- Timeline (single-day builder, seeded) ---------------------------------------------

export type DemoBlock = {
  id: string;
  title: string;
  category: "culture" | "food" | "nature" | "shopping" | "transit";
  date: string;
  startMinute: number;
  durationMinutes: number;
  locked?: boolean;
  note?: string;
  /** Set only for a block scheduled from DEMO_POOL -- lets it reappear in the pool when
   * removed, instead of a seeded itinerary block that just vanishes. */
  poolId?: string;
  /** Set when a second place has been dropped onto this same time slot -- renders as two
   * cards side by side instead of one. Only one split partner is supported at a time. */
  split?: { title: string; category: DemoBlock["category"]; poolId?: string };
};

export const DEMO_ITINERARY: DemoBlock[] = [
  { id: "b1", title: "Street of Harmony walk", category: "culture", date: "2026-10-03", startMinute: 9 * 60 + 30, durationMinutes: 120 },
  { id: "b2", title: "Hawker lunch, Chulia Street", category: "food", date: "2026-10-03", startMinute: 12 * 60, durationMinutes: 75, note: "Shellfish-free stalls only" },
  { id: "b3", title: "Clan Jetties + Armenian Street", category: "culture", date: "2026-10-03", startMinute: 15 * 60, durationMinutes: 120 },
  { id: "b4", title: "Peranakan Mansion (guided)", category: "culture", date: "2026-10-04", startMinute: 10 * 60, durationMinutes: 90, locked: true, note: "Booked — 15:30 last tour" },
  { id: "b5", title: "Kaya toast, Campbell House", category: "food", date: "2026-10-04", startMinute: 15 * 60 + 30, durationMinutes: 60 },
  { id: "b6", title: "Penang Hill early ascent", category: "nature", date: "2026-10-05", startMinute: 8 * 60, durationMinutes: 180 },
];

export type DemoPoolItem = {
  id: string;
  name: string;
  category: "culture" | "food" | "nature" | "shopping";
  durationMinutes: number;
  costTier: "budget" | "standard" | "premium" | "luxury";
  blurb: string;
  safety: "verified" | "claimed" | "unknown";
};

export const DEMO_POOL: DemoPoolItem[] = [
  { id: "p1", name: "Kek Lok Si Temple", category: "culture", durationMinutes: 120, costTier: "budget", blurb: "Hillside temple complex above Air Itam.", safety: "verified" },
  { id: "p2", name: "Gurney Drive hawker stalls", category: "food", durationMinutes: 90, costTier: "budget", blurb: "Seafront food court — has shellfish-free stalls.", safety: "claimed" },
  { id: "p3", name: "Penang Botanic Gardens", category: "nature", durationMinutes: 120, costTier: "budget", blurb: "Monkey Cup garden and a shaded loop trail.", safety: "verified" },
  { id: "p4", name: "Hin Bus Depot market", category: "shopping", durationMinutes: 75, costTier: "standard", blurb: "Sunday makers' market in a former bus depot.", safety: "unknown" },
  { id: "p5", name: "Wonderfood Museum", category: "culture", durationMinutes: 60, costTier: "standard", blurb: "Indoor — good rain fallback.", safety: "verified" },
];

// --- Map + routing (feature: live map and travel-time routing) -------------------------

export type DemoMapStop = {
  id: string;
  order: number;
  name: string;
  time: string;
  /** Percentage coordinates on the stylised fallback canvas (0–100). */
  x: number;
  y: number;
  /** Real coordinates (approx.), used when a Google Maps embed key is configured. */
  lat: number;
  lng: number;
};

export type DemoRouteLeg = {
  fromId: string;
  toId: string;
  mode: "walk" | "drive" | "funicular";
  minutes: number;
  distanceKm: number;
  /** Illustrative road-condition tint for this leg — demo data, not live traffic. */
  congestion?: "low" | "medium" | "high";
};

export const DEMO_MAP_STOPS: Record<string, DemoMapStop[]> = {
  "2026-10-03": [
    { id: "s1", order: 1, name: "Street of Harmony", time: "09:30", x: 22, y: 30, lat: 5.41652, lng: 100.33556 },
    { id: "s2", order: 2, name: "Chulia Street hawkers", time: "12:00", x: 46, y: 24, lat: 5.41639, lng: 100.33344 },
    { id: "s3", order: 3, name: "Clan Jetties", time: "15:00", x: 74, y: 44, lat: 5.41296, lng: 100.34320 },
    { id: "s4", order: 4, name: "Armenian Street art", time: "17:15", x: 52, y: 66, lat: 5.41519, lng: 100.34047 },
  ],
  "2026-10-04": [
    { id: "s5", order: 1, name: "Peranakan Mansion", time: "10:00", x: 30, y: 38, lat: 5.41882, lng: 100.33776 },
    { id: "s6", order: 2, name: "Campbell House tea", time: "15:30", x: 58, y: 30, lat: 5.41748, lng: 100.33499 },
    { id: "s7", order: 3, name: "Love Lane (jazz, optional)", time: "21:00", x: 44, y: 64, lat: 5.41930, lng: 100.33700 },
  ],
  "2026-10-05": [
    { id: "s8", order: 1, name: "Penang Hill lower station", time: "08:00", x: 30, y: 62, lat: 5.40092, lng: 100.27906 },
    { id: "s9", order: 2, name: "Penang Hill summit", time: "08:40", x: 22, y: 24, lat: 5.42509, lng: 100.26810 },
  ],
};

/**
 * Measured against the Google Walking Directions API for the stop coordinates above, rather
 * than invented — the earlier hand-written figures disagreed with the live route by as much as
 * 2.5x, which showed up as the map list and Street View quoting different distances for the
 * same leg. The funicular leg keeps its real 6-minute ride time; its distance is the walking
 * route Google returns for that pair.
 */
export const DEMO_ROUTE_LEGS: Record<string, DemoRouteLeg[]> = {
  "2026-10-03": [
    { fromId: "s1", toId: "s2", mode: "walk", minutes: 4, distanceKm: 0.27, congestion: "low" },
    { fromId: "s2", toId: "s3", mode: "walk", minutes: 20, distanceKm: 1.38, congestion: "high" },
    { fromId: "s3", toId: "s4", mode: "walk", minutes: 8, distanceKm: 0.54, congestion: "medium" },
  ],
  "2026-10-04": [
    { fromId: "s5", toId: "s6", mode: "walk", minutes: 7, distanceKm: 0.49, congestion: "low" },
    { fromId: "s6", toId: "s7", mode: "walk", minutes: 6, distanceKm: 0.41, congestion: "medium" },
  ],
  "2026-10-05": [
    { fromId: "s8", toId: "s9", mode: "funicular", minutes: 6, distanceKm: 7.86, congestion: "low" },
  ],
};

// --- Chat preference extraction (feature) ---------------------------------------------

export type DemoSignal = {
  id: string;
  kind: "soft" | "hard-candidate";
  label: string;
  /** The chat line this was inferred from. */
  quote: string;
  /** Whom a hard-constraint candidate is routed to; null for a group-wide soft signal. */
  forMemberId: string | null;
  forMemberName: string | null;
  expiresInDays: number | null;
  detail: string;
};

export const DEMO_SIGNALS: DemoSignal[] = [
  {
    id: "sig-jazz", kind: "soft", label: "live jazz", quote: "I'd love a jazz bar one evening if there's one nearby",
    forMemberId: null, forMemberName: null, expiresInDays: 3,
    detail: "A soft discovery signal. If confirmed it nudges evening suggestions toward live music for this trip only — it never changes anyone's saved preferences.",
  },
  {
    id: "sig-indoor", kind: "soft", label: "indoor day Saturday", quote: "Rain forecast for Saturday afternoon btw",
    forMemberId: null, forMemberName: null, expiresInDays: 2,
    detail: "A soft, time-boxed signal. Confirming it asks the planner to keep Saturday afternoon indoors; it expires on its own after the trip date.",
  },
  {
    id: "sig-shellfish", kind: "hard-candidate", label: "no shellfish", quote: "heads up, I can't do shellfish at all",
    forMemberId: ARUN, forMemberName: "Arun", expiresInDays: null,
    detail: "A possible hard safety constraint. It stays inert until Arun confirms it — the assistant cannot add a dietary constraint on someone's behalf. On confirmation it enters the deterministic safety gate and every food stop is re-checked.",
  },
];

// --- Daily start / finish times (feature) -------------------------------------------

export type DemoRhythm = { memberId: string; memberName: string; start: string; end: string };

export const DEMO_RHYTHMS: DemoRhythm[] = [
  { memberId: DEMO_USER.id, memberName: "You", start: "09:00", end: "22:00" },
  { memberId: MEI, memberName: "Mei", start: "08:30", end: "21:00" },
  { memberId: ARUN, memberName: "Arun", start: "10:00", end: "23:30" },
];

// --- Preference survey + editor (feature) ------------------------------------------

export type DemoInterest = { key: string; label: string };

export const DEMO_INTERESTS: DemoInterest[] = [
  { key: "heritage", label: "Heritage & history" },
  { key: "food", label: "Food & markets" },
  { key: "nature", label: "Nature & outdoors" },
  { key: "urban", label: "Urban & nightlife" },
  { key: "shopping", label: "Shopping & craft" },
  { key: "photography", label: "Photography" },
];

export const DEMO_PREFERENCES = {
  /** Ranked most-wanted first; drives the jigsaw member weight. */
  interestOrder: ["food", "heritage", "photography", "nature", "urban", "shopping"],
  budgetTier: "standard" as const,
  pace: "balanced" as const,
  socialRole: "planner" as "planner" | "follower" | "navigator",
  dailyWalkCapKm: 6,
};
