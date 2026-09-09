import type { Expense } from "@/lib/domain/debt-simplify";
import type { TimelineBlock } from "@/lib/domain/jigsaw";
import { DEMO_MEMBERS } from "./fixtures";

/**
 * Fixtures for the showcase features layered on top of the core demo trip (jigsaw split, budget
 * ledger, weather disruption, food-safety check, packing list). Kept apart from fixtures.ts so
 * the core trip data stays readable; member ids are imported so both stay in sync.
 *
 * Where a real domain module exists, these feed it rather than pre-computing the answer:
 * the ledger runs through `simplifyDebts`, the jigsaw through `evaluateTeam`.
 */

export const YOU = DEMO_MEMBERS[0].id;
export const MEI = DEMO_MEMBERS[1].id;
export const ARUN = DEMO_MEMBERS[2].id;
export const MEMBER_IDS = [YOU, MEI, ARUN] as const;

export const memberName = (id: string) => DEMO_MEMBERS.find((m) => m.id === id)?.displayName ?? "Member";
export const memberColor = (id: string) => DEMO_MEMBERS.find((m) => m.id === id)?.color ?? "#888";

// --- Jigsaw: Saturday afternoon, where the group pulls apart -----------------------------

/**
 * Candidates for the contested 14:00–17:00 window, with each member's 1–10 satisfaction.
 * These numbers are tuned so the real engine genuinely fires: the together-plan leaves Arun
 * at 0.47 of his own best case (below MIN_SATISFACTION_RATIO 0.7) and the spread crosses
 * SPLIT_STDDEV_THRESHOLD, so `shouldSplitCut` returns true on its own rather than being told to.
 */
export const DEMO_JIGSAW_CANDIDATES: TimelineBlock[] = [
  {
    id: "j-street-food", title: "Chulia Street food crawl", category: "food",
    durationMinutes: 120, startMinute: 14 * 60, weight: 8, fixedTime: false,
    satisfaction: { [YOU]: 8, [MEI]: 10, [ARUN]: 2 }, ownerId: MEI,
  },
  {
    id: "j-peranakan", title: "Peranakan Mansion tour", category: "culture",
    durationMinutes: 90, startMinute: 14 * 60, weight: 7, fixedTime: false,
    satisfaction: { [YOU]: 8, [MEI]: 4, [ARUN]: 9 }, ownerId: ARUN,
  },
  {
    id: "j-jetty", title: "Clan Jetties walk", category: "culture",
    durationMinutes: 90, startMinute: 15 * 60 + 30, weight: 6, fixedTime: false,
    satisfaction: { [YOU]: 7, [MEI]: 6, [ARUN]: 5 }, ownerId: null,
  },
  {
    id: "j-batik", title: "Batik workshop", category: "shopping",
    durationMinutes: 120, startMinute: 14 * 60, weight: 5, fixedTime: false,
    satisfaction: { [YOU]: 4, [MEI]: 7, [ARUN]: 2 }, ownerId: MEI,
  },
  {
    id: "j-museum", title: "Wonderfood Museum", category: "culture",
    durationMinutes: 60, startMinute: 16 * 60, weight: 5, fixedTime: false,
    satisfaction: { [YOU]: 5, [MEI]: 6, [ARUN]: 6 }, ownerId: null,
  },
];

/** What a single shared trajectory would schedule — the "everyone together" plan. */
export const DEMO_JIGSAW_TOGETHER = ["j-street-food", "j-jetty"];

/**
 * The split the engine proposes when one trajectory leaves someone too far behind. The majority
 * keeps its plan, the outlier gets their own thread, and both reconverge at the anchor — the
 * README's split-and-merge, not a vote that would just outnumber Arun again.
 */
export const DEMO_SPLIT = {
  /** Day 1 — the same afternoon whose stops the map already routes. */
  date: "2026-10-03",
  window: { startMinute: 14 * 60, endMinute: 17 * 60 },
  branches: [
    { id: "a", label: "Food branch", memberIds: [YOU, MEI], blockIds: ["j-street-food", "j-jetty"] },
    { id: "b", label: "Heritage branch", memberIds: [ARUN], blockIds: ["j-peranakan", "j-museum"] },
  ],
  /** Where both branches reconverge — drawn on the map as the rendezvous anchor. */
  rendezvous: {
    id: "rv", name: "Armenian Street art", time: "17:15",
    lat: 5.41519, lng: 100.34047,
  },
} as const;

// --- Budget ledger: real expenses, settled by lib/domain/debt-simplify ------------------

export const CURRENCY = "RM";

export type DemoExpense = Expense & { label: string; category: string; paidOn: string };

/** Integer sen — no floating point anywhere near money. */
export const DEMO_EXPENSES: DemoExpense[] = [
  { id: "e1", label: "Hawker lunch, Chulia Street", category: "Food", paidOn: "2026-10-03", payerId: MEI, amountMinor: 4_500, beneficiaryIds: [YOU, MEI, ARUN] },
  { id: "e2", label: "Peranakan Mansion tickets", category: "Culture", paidOn: "2026-10-04", payerId: YOU, amountMinor: 8_100, beneficiaryIds: [YOU, MEI, ARUN] },
  { id: "e3", label: "Grab to Penang Hill", category: "Transport", paidOn: "2026-10-05", payerId: ARUN, amountMinor: 3_200, beneficiaryIds: [YOU, MEI, ARUN] },
  { id: "e4", label: "Kaya toast + tea", category: "Food", paidOn: "2026-10-04", payerId: MEI, amountMinor: 2_400, beneficiaryIds: [YOU, MEI] },
  { id: "e5", label: "Funicular tickets", category: "Transport", paidOn: "2026-10-05", payerId: YOU, amountMinor: 6_000, beneficiaryIds: [YOU, MEI, ARUN] },
  { id: "e6", label: "Street art guide booklet", category: "Culture", paidOn: "2026-10-03", payerId: ARUN, amountMinor: 1_800, beneficiaryIds: [ARUN] },
];

// --- Weather disruption -----------------------------------------------------------------

// (weather scenario below is unrelated to the leg figures corrected in fixtures.ts)
export const DEMO_WEATHER = {
  date: "2026-10-04",
  headline: "Heavy rain expected 14:00–18:00",
  detail: "A thunderstorm warning covers George Town for Saturday afternoon.",
  /** The outdoor block this invalidates (matches DEMO_ITINERARY). */
  affectedBlockId: "b5",
  affectedTitle: "Kaya toast, Campbell House",
  replacement: {
    title: "Wonderfood Museum",
    why: "Indoor, 6 minutes' walk from your 10:00 stop, and it keeps the afternoon within the group's shared window.",
    durationMinutes: 60,
    startMinute: 15 * 60 + 30,
    costTier: "standard" as const,
  },
} as const;

// --- Food-safety visual check -----------------------------------------------------------

export type VqaVerdict = "unsafe" | "caution" | "clear";

export const DEMO_VQA = {
  dish: "Char kway teow",
  stall: "Chulia Street hawker centre, stall 14",
  /** What the vision pass claims it can see. Claims, not proof — the gate decides. */
  detected: [
    { label: "Flat rice noodles", confidence: 0.97, risk: false },
    { label: "Prawns", confidence: 0.91, risk: true },
    { label: "Cockles", confidence: 0.78, risk: true },
    { label: "Chinese sausage", confidence: 0.84, risk: false },
    { label: "Bean sprouts", confidence: 0.88, risk: false },
  ],
  verdict: "unsafe" as VqaVerdict,
  affectedMemberId: ARUN,
  constraint: "No shellfish",
  headline: "Shellfish detected — not safe for Arun",
  reasoning:
    "Prawns and cockles are standard in this dish and both are visible in the image. Arun's confirmed no-shellfish requirement is a hard constraint, so this fails closed rather than being flagged as a maybe.",
  alternative: "Ask for it without prawns and cockles, or order the duck egg version at stall 9.",
} as const;

// --- Packing checklist ------------------------------------------------------------------

export type PackItem = { id: string; label: string; reason: string };
export type PackGroup = { id: string; title: string; source: string; items: PackItem[] };

export const DEMO_PACKING: PackGroup[] = [
  {
    id: "weather", title: "Weather", source: "Rain forecast Sat 14:00–18:00 · 31 °C, humid",
    items: [
      { id: "p1", label: "Compact umbrella", reason: "Saturday afternoon thunderstorm" },
      { id: "p2", label: "Quick-dry shirt", reason: "31 °C and humid all three days" },
      { id: "p3", label: "Waterproof phone pouch", reason: "You're on foot through the rain window" },
    ],
  },
  {
    id: "dress", title: "Dress code", source: "Street of Harmony · mosque and temple visits",
    items: [
      { id: "p4", label: "Shoulder-covering top", reason: "Kapitan Keling Mosque requires covered shoulders" },
      { id: "p5", label: "Long trousers or skirt", reason: "Temple entry on the Street of Harmony walk" },
      { id: "p6", label: "Slip-on shoes", reason: "Shoes come off at several stops" },
    ],
  },
  {
    id: "safety", title: "Safety & health", source: "Arun · confirmed no-shellfish requirement",
    items: [
      { id: "p7", label: "Allergy card (Malay + English)", reason: "Shows hawker stalls the shellfish restriction" },
      { id: "p8", label: "Antihistamine", reason: "Carried for Arun's confirmed allergy" },
      { id: "p9", label: "Reef-safe sunscreen", reason: "Penang Hill morning is fully exposed" },
    ],
  },
];
