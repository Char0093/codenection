import type { GeminiActivity } from "@/lib/gemini/types";
import { DEMO_POOL, type DemoBlock } from "@/lib/prototype/fixtures";

/** A Plan-tab activity with a demo-only `location` line layered on top of the real Gemini shape.
 * Purely additive -- `lib/gemini/schemas.ts` (the actual AI generation schema/prompt) is
 * untouched, so a real (non-demo) proposal simply never has this field. */
export type DemoPlanActivity = GeminiActivity & { location?: string };

const FALLBACK_COST_TIER: GeminiActivity["estimatedCostTier"] = "standard";
const FALLBACK_RATIONALE = "Added while planning the trip.";

function sharedSlotNote(otherTitle: string): string {
  return `Sharing this time slot with ${otherTitle} — the group hasn't chosen between them yet.`;
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toActivity(params: {
  title: string;
  category: DemoBlock["category"];
  date: string;
  startMinute: number;
  durationMinutes: number;
  poolId?: string;
  rationale?: string;
  contingencyNote?: string | null;
  location?: string;
  estimatedCostTier?: DemoBlock["estimatedCostTier"];
  sharedWith?: string;
}): DemoPlanActivity {
  const pool = params.poolId ? DEMO_POOL.find((p) => p.id === params.poolId) : undefined;
  const baseNote = params.contingencyNote ?? null;
  const contingencyNote = params.sharedWith
    ? `${baseNote ? `${baseNote} ` : ""}${sharedSlotNote(params.sharedWith)}`
    : baseNote;
  return {
    title: params.title,
    category: params.category,
    date: params.date,
    startTime: minutesToHHMM(params.startMinute),
    durationMinutes: params.durationMinutes,
    estimatedCostTier: params.estimatedCostTier ?? pool?.costTier ?? FALLBACK_COST_TIER,
    rationale: params.rationale ?? pool?.blurb ?? FALLBACK_RATIONALE,
    contingencyNote,
    location: params.location ?? pool?.location,
  };
}

/** The Plan tab's per-stop activities, derived from the itinerary the group has actually agreed
 * to (DemoTripStateProvider's `planBlocks`) instead of a separately hardcoded list -- so a
 * Timeline change that's been saved and agreed to shows up here too. A block sharing its slot
 * with a split partner (see DemoBlock.split) renders as two adjacent activities, each noting the
 * other, so that outcome is visible on Plan as well as on the Timeline. */
export function buildPlanActivities(blocks: DemoBlock[]): DemoPlanActivity[] {
  const sorted = [...blocks].sort((a, b) => (a.date === b.date ? a.startMinute - b.startMinute : a.date.localeCompare(b.date)));
  const activities: DemoPlanActivity[] = [];
  for (const b of sorted) {
    activities.push(toActivity({
      title: b.title, category: b.category, date: b.date, startMinute: b.startMinute, durationMinutes: b.durationMinutes,
      poolId: b.poolId, rationale: b.rationale, contingencyNote: b.contingencyNote, location: b.location,
      estimatedCostTier: b.estimatedCostTier, sharedWith: b.split?.title,
    }));
    if (b.split) {
      activities.push(toActivity({
        title: b.split.title, category: b.split.category, date: b.date, startMinute: b.startMinute, durationMinutes: b.durationMinutes,
        poolId: b.split.poolId, location: b.split.location, sharedWith: b.title,
      }));
    }
  }
  return activities;
}
