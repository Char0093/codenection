import type { ActivityCandidate } from "@/lib/domain/itinerary";

/**
 * Level 0 - Pre-trip Timeline Jigsaw.
 *
 * Pure scheduling and bargaining logic for the drag-and-drop timeline. Nothing here does I/O,
 * reads the clock, or mutates its inputs, so a UI drag and a server revalidation can run the
 * same functions and reach the same answer.
 *
 * The four-step pipeline (see Implementation_Plan.md):
 *   1. Rigid anchor locking    -> partitionAnchors
 *   2. Pareto frontier filling -> paretoFill
 *   3. Round-robin veto        -> roundRobinVeto
 *   4. Explicit split cut      -> shouldSplitCut
 */

/** Timeline grid unit. Blocks snap to 30-minute boundaries. */
export const SLOT_MINUTES = 30;
export const DAY_MINUTES = 24 * 60;

/** A block becomes an immovable red anchor at or above this weight, when its time is fixed. */
export const ANCHOR_WEIGHT_THRESHOLD = 9;

/** Pareto filling must not push any member below this share of their own best case. */
export const MIN_SATISFACTION_RATIO = 0.7;

/** Above this satisfaction spread the group is too divided to share one trajectory. */
export const SPLIT_STDDEV_THRESHOLD = 2;

/** Split branches must reconverge at the merge anchor within this variance. */
export const MERGE_VARIANCE_MINUTES = 10;

/** Elastic snapping radius around an anchor, so meal times are never missed. */
export const MAGNET_RADIUS_MINUTES = 20;

export type BlockTexture = "consensus" | "ai-fill" | "wishlist";

export type TimelineBlock = {
  id: string;
  title: string;
  category: ActivityCandidate["category"];
  /** Estimated stay duration including transit handover. */
  durationMinutes: number;
  /** Minutes from local midnight, or null while the block sits in the scheduling pool. */
  startMinute: number | null;
  /** Proposer insistence, 1-10. */
  weight: number;
  fixedTime: boolean;
  /** Per-member satisfaction, 1-10. Members absent from the map score 0. */
  satisfaction: Readonly<Record<string, number>>;
  ownerId: string | null;
};

export type Window = { startMinute: number; endMinute: number };

export type Conflict = { firstId: string; secondId: string; overlapMinutes: number };

export type TrilemmaOption =
  | { kind: "shorten"; blockId: string; newDurationMinutes: number; label: string }
  | { kind: "replace"; blockId: string; label: string }
  | { kind: "split"; blockIds: [string, string]; label: string };

export type MemberOutcome = {
  memberId: string;
  achieved: number;
  baseline: number;
  /** achieved / baseline, clamped to [0, 1]. Reads 1 when a member has no preferences at all. */
  ratio: number;
  /** baseline - achieved. The quantity minimax regret minimises. */
  regret: number;
};

export type TeamOutcome = {
  members: MemberOutcome[];
  total: number;
  meanRatio: number;
  /** Population standard deviation of per-member satisfaction, on the raw 1-10 scale. */
  stdDev: number;
  maxRegret: number;
  worstMemberId: string | null;
  /** True when every member sits at or above MIN_SATISFACTION_RATIO. */
  fair: boolean;
};

function scoreFor(block: TimelineBlock, memberId: string): number {
  const value = block.satisfaction[memberId];
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sortByStart(blocks: readonly TimelineBlock[]): TimelineBlock[] {
  return blocks
    .filter((block) => block.startMinute !== null)
    .slice()
    .sort(
      (left, right) =>
        (left.startMinute as number) - (right.startMinute as number) || left.id.localeCompare(right.id),
    );
}

/** Rendered width in grid slots. Never narrower than one slot, so a short stop stays grabbable. */
export function blockWidthSlots(block: TimelineBlock): number {
  return Math.max(1, Math.ceil(block.durationMinutes / SLOT_MINUTES));
}

/**
 * Visual texture per the UI spec: solid green when every member is happy, blue dots for a
 * personal wishlist item, orange stripes for an AI-recommended flexible fill.
 */
export function blockTexture(block: TimelineBlock, memberIds: readonly string[]): BlockTexture {
  if (memberIds.length > 0 && memberIds.every((memberId) => scoreFor(block, memberId) >= 7)) return "consensus";
  if (block.ownerId !== null) return "wishlist";
  return "ai-fill";
}

/** Snap a raw drag position to the 30-minute grid, clamped inside the day. */
export function snapToGrid(minute: number): number {
  const snapped = Math.round(minute / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.min(Math.max(snapped, 0), DAY_MINUTES);
}

export function isRigidAnchor(block: TimelineBlock): boolean {
  return block.weight >= ANCHOR_WEIGHT_THRESHOLD && block.fixedTime && block.startMinute !== null;
}

/** Step 1. Freeze must-do fixed-time blocks; everything else drops into the scheduling pool. */
export function partitionAnchors(blocks: readonly TimelineBlock[]): {
  anchors: TimelineBlock[];
  pool: TimelineBlock[];
} {
  const anchors: TimelineBlock[] = [];
  const pool: TimelineBlock[] = [];
  for (const block of blocks) (isRigidAnchor(block) ? anchors : pool).push(block);
  return { anchors: sortByStart(anchors), pool };
}

/** The gaps between rigid anchors, which are the only places other blocks may land. */
export function idleWindows(
  anchors: readonly TimelineBlock[],
  dayStartMinute = 8 * 60,
  dayEndMinute = 23 * 60,
): Window[] {
  const windows: Window[] = [];
  let cursor = dayStartMinute;
  for (const anchor of sortByStart(anchors)) {
    const start = anchor.startMinute as number;
    if (start > cursor) windows.push({ startMinute: cursor, endMinute: Math.min(start, dayEndMinute) });
    cursor = Math.max(cursor, start + anchor.durationMinutes);
  }
  if (cursor < dayEndMinute) windows.push({ startMinute: cursor, endMinute: dayEndMinute });
  return windows.filter((window) => window.endMinute - window.startMinute >= SLOT_MINUTES);
}

/**
 * Elastic snapping. A block dragged near an anchor is pulled flush against it so meal times are
 * never missed; otherwise it just lands on the grid.
 */
export function magneticSnap(
  rawStartMinute: number,
  block: TimelineBlock,
  anchors: readonly TimelineBlock[],
): number {
  const gridded = snapToGrid(rawStartMinute);
  const droppedEnd = gridded + block.durationMinutes;
  let best = gridded;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const anchor of anchors) {
    if (anchor.startMinute === null || anchor.id === block.id) continue;
    const anchorStart = anchor.startMinute;
    const anchorEnd = anchorStart + anchor.durationMinutes;

    // Distance from the dropped block to the anchor, negative when the two collide. A block
    // dropped on top of a meal anchor is in range, so releasing it pushes the block clear
    // instead of leaving the meal buried.
    const gap =
      gridded >= anchorEnd ? gridded - anchorEnd : droppedEnd <= anchorStart ? anchorStart - droppedEnd : -1;
    if (gap > MAGNET_RADIUS_MINUTES) continue;

    for (const target of [anchorStart - block.durationMinutes, anchorEnd]) {
      const distance = Math.abs(gridded - target);
      if (target >= 0 && distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
  }
  return Math.min(Math.max(best, 0), DAY_MINUTES);
}

export function overlapMinutes(left: TimelineBlock, right: TimelineBlock): number {
  if (left.startMinute === null || right.startMinute === null) return 0;
  const start = Math.max(left.startMinute, right.startMinute);
  const end = Math.min(left.startMinute + left.durationMinutes, right.startMinute + right.durationMinutes);
  return Math.max(0, end - start);
}

/** Every overlapping pair on the timeline, earlier block first. */
export function detectConflicts(blocks: readonly TimelineBlock[]): Conflict[] {
  const placed = sortByStart(blocks);
  const conflicts: Conflict[] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const minutes = overlapMinutes(placed[i], placed[j]);
      if (minutes > 0) {
        conflicts.push({ firstId: placed[i].id, secondId: placed[j].id, overlapMinutes: minutes });
      }
    }
  }
  return conflicts;
}

/** The one-click trilemma offered when two dragged blocks collide. */
export function trilemmaOptions(conflict: Conflict, blocks: readonly TimelineBlock[]): TrilemmaOption[] {
  const first = blocks.find((block) => block.id === conflict.firstId);
  const second = blocks.find((block) => block.id === conflict.secondId);
  if (!first || !second) return [];
  const shortened = Math.max(SLOT_MINUTES, first.durationMinutes - conflict.overlapMinutes);
  return [
    { kind: "shorten", blockId: first.id, newDurationMinutes: shortened, label: "Shorten " + first.title },
    { kind: "replace", blockId: second.id, label: "Replace " + second.title },
    { kind: "split", blockIds: [first.id, second.id], label: "Split into two trajectories" },
  ];
}

/**
 * Per-member and team satisfaction for a proposed schedule.
 *
 * A member baseline is their own best case at the same schedule size: the blocks they personally
 * score highest, over every candidate. Measuring against that rather than against a raw total is
 * what makes regret comparable between members with different tastes.
 */
export function evaluateTeam(
  scheduled: readonly TimelineBlock[],
  candidates: readonly TimelineBlock[],
  memberIds: readonly string[],
): TeamOutcome {
  const size = scheduled.length;
  const members: MemberOutcome[] = memberIds.map((memberId) => {
    const achieved = scheduled.reduce((sum, block) => sum + scoreFor(block, memberId), 0);
    const baseline = candidates
      .map((block) => scoreFor(block, memberId))
      .sort((left, right) => right - left)
      .slice(0, size)
      .reduce((sum, score) => sum + score, 0);
    const ratio = baseline <= 0 ? 1 : Math.min(1, achieved / baseline);
    return { memberId, achieved, baseline, ratio, regret: Math.max(0, baseline - achieved) };
  });

  const total = members.reduce((sum, member) => sum + member.achieved, 0);
  const meanRatio = members.length
    ? members.reduce((sum, member) => sum + member.ratio, 0) / members.length
    : 1;
  const mean = members.length ? total / members.length : 0;
  const variance = members.length
    ? members.reduce((sum, member) => sum + (member.achieved - mean) ** 2, 0) / members.length
    : 0;
  const worst = members.reduce<MemberOutcome | null>(
    (lowest, member) => (lowest === null || member.regret > lowest.regret ? member : lowest),
    null,
  );

  return {
    members,
    total,
    meanRatio,
    stdDev: Math.sqrt(variance),
    maxRegret: worst?.regret ?? 0,
    worstMemberId: worst && worst.regret > 0 ? worst.memberId : null,
    fair: members.every((member) => member.ratio >= MIN_SATISFACTION_RATIO),
  };
}

function place(block: TimelineBlock, startMinute: number): TimelineBlock {
  return { ...block, startMinute };
}

function firstFit(
  block: TimelineBlock,
  windows: readonly Window[],
  taken: readonly TimelineBlock[],
): number | null {
  for (const window of windows) {
    for (let start = window.startMinute; start + block.durationMinutes <= window.endMinute; start += SLOT_MINUTES) {
      const probe = place(block, start);
      if (!taken.some((other) => overlapMinutes(probe, other) > 0)) return start;
    }
  }
  return null;
}

/**
 * Step 2 - Pareto frontier filling.
 *
 * Greedy multi-objective fill by team-satisfaction density, then a repair pass that swaps in the
 * worst-off member's best remaining block until nobody sits below MIN_SATISFACTION_RATIO. Greedy
 * plus repair is deliberate: it is deterministic and fast enough to re-run on every drag. The
 * exact CP-SAT solve for the full multi-day problem lives in the Python optimizer service.
 */
export function paretoFill(
  pool: readonly TimelineBlock[],
  windows: readonly Window[],
  memberIds: readonly string[],
  anchors: readonly TimelineBlock[] = [],
): { scheduled: TimelineBlock[]; unplaced: TimelineBlock[]; outcome: TeamOutcome } {
  const density = (block: TimelineBlock) =>
    memberIds.reduce((sum, memberId) => sum + scoreFor(block, memberId), 0) / Math.max(1, block.durationMinutes);

  const ordered = pool
    .slice()
    .sort((left, right) => density(right) - density(left) || left.id.localeCompare(right.id));
  let scheduled: TimelineBlock[] = [];
  const unplaced: TimelineBlock[] = [];

  for (const block of ordered) {
    const start = firstFit(block, windows, [...anchors, ...scheduled]);
    if (start === null) unplaced.push(block);
    else scheduled.push(place(block, start));
  }

  // Repair: give the most-aggrieved member their best unplaced block, evicting whichever
  // scheduled block that member values least, until the fairness floor holds or no swap helps.
  for (let pass = 0; pass < pool.length; pass += 1) {
    const outcome = evaluateTeam(scheduled, pool, memberIds);
    if (outcome.fair || outcome.worstMemberId === null) break;
    const victim = outcome.worstMemberId;

    const wanted = unplaced
      .slice()
      .sort((left, right) => scoreFor(right, victim) - scoreFor(left, victim) || left.id.localeCompare(right.id))[0];
    if (!wanted || scoreFor(wanted, victim) === 0) break;

    const evictable = scheduled
      .slice()
      .sort((left, right) => scoreFor(left, victim) - scoreFor(right, victim) || left.id.localeCompare(right.id))[0];
    if (!evictable || scoreFor(evictable, victim) >= scoreFor(wanted, victim)) break;

    const remaining = scheduled.filter((block) => block.id !== evictable.id);
    const start = firstFit(wanted, windows, [...anchors, ...remaining]);
    if (start === null) break;

    scheduled = [...remaining, place(wanted, start)];
    unplaced.splice(unplaced.indexOf(wanted), 1);
    unplaced.push({ ...evictable, startMinute: null });
  }

  scheduled.sort((left, right) => (left.startMinute as number) - (right.startMinute as number));
  return { scheduled, unplaced, outcome: evaluateTeam(scheduled, pool, memberIds) };
}

/**
 * Step 3 - Round-robin veto ("wish wheel").
 *
 * Members take turns, in the supplied contribution order, forcibly placing one block each. What
 * never fits falls into the unaccommodated wish pool, which the UI offers as Level 2 micro-zone
 * split targets rather than silently discarding.
 */
export function roundRobinVeto(
  pool: readonly TimelineBlock[],
  windows: readonly Window[],
  memberOrder: readonly string[],
  anchors: readonly TimelineBlock[] = [],
): { scheduled: TimelineBlock[]; wishPool: TimelineBlock[] } {
  const scheduled: TimelineBlock[] = [];
  const wishPool: TimelineBlock[] = [];
  const remaining = pool.slice();

  let progressed = true;
  while (progressed && remaining.length > 0) {
    progressed = false;
    for (const memberId of memberOrder) {
      const choice = remaining
        .slice()
        .sort((left, right) => scoreFor(right, memberId) - scoreFor(left, memberId) || left.id.localeCompare(right.id))[0];
      if (!choice || scoreFor(choice, memberId) === 0) continue;

      const start = firstFit(choice, windows, [...anchors, ...scheduled]);
      remaining.splice(remaining.indexOf(choice), 1);
      progressed = true;

      // A block nobody can fit is collected, not silently dropped: the UI offers the wish pool
      // as Level 2 micro-zone split targets.
      if (start === null) wishPool.push({ ...choice, startMinute: null });
      else scheduled.push(place(choice, start));
    }
  }

  scheduled.sort((left, right) => (left.startMinute as number) - (right.startMinute as number));
  return { scheduled, wishPool: [...wishPool, ...remaining.map((block) => ({ ...block, startMinute: null }))] };
}

/**
 * Step 4 - Explicit split cut. When the group is too divided to share one trajectory, the UI
 * draws the scissors line and the branches reconverge at the merge anchor.
 */
export function shouldSplitCut(outcome: TeamOutcome, threshold = SPLIT_STDDEV_THRESHOLD): boolean {
  return outcome.stdDev > threshold || !outcome.fair;
}

/** True when both branches reach the merge anchor inside MERGE_VARIANCE_MINUTES. */
export function mergeIsPunctual(
  branchArrivalMinutes: readonly number[],
  anchorMinute: number,
  variance = MERGE_VARIANCE_MINUTES,
): boolean {
  return branchArrivalMinutes.every((arrival) => Math.abs(arrival - anchorMinute) <= variance);
}
