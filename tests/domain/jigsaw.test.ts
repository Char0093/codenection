import { describe, expect, it } from "vitest";
import {
  ANCHOR_WEIGHT_THRESHOLD,
  DAY_MINUTES,
  MIN_SATISFACTION_RATIO,
  SLOT_MINUTES,
  type TimelineBlock,
  blockTexture,
  blockWidthSlots,
  detectConflicts,
  evaluateTeam,
  idleWindows,
  isRigidAnchor,
  magneticSnap,
  mergeIsPunctual,
  overlapMinutes,
  paretoFill,
  partitionAnchors,
  roundRobinVeto,
  shouldSplitCut,
  snapToGrid,
  trilemmaOptions,
} from "@/lib/domain/jigsaw";

const members = ["amira", "ben", "chloe", "danish"];

function block(overrides: Partial<TimelineBlock> & { id: string }): TimelineBlock {
  return {
    title: "Block " + overrides.id,
    category: "culture",
    durationMinutes: 60,
    startMinute: null,
    weight: 5,
    fixedTime: false,
    satisfaction: {},
    ownerId: null,
    ...overrides,
  };
}

const evenly = (score: number) => Object.fromEntries(members.map((id) => [id, score]));

describe("block geometry", () => {
  it("scales width with duration and never renders narrower than one slot", () => {
    expect(blockWidthSlots(block({ id: "a", durationMinutes: 30 }))).toBe(1);
    expect(blockWidthSlots(block({ id: "b", durationMinutes: 90 }))).toBe(3);
    // A 10-minute coffee stop still needs a grabbable drag target.
    expect(blockWidthSlots(block({ id: "c", durationMinutes: 10 }))).toBe(1);
    expect(blockWidthSlots(block({ id: "d", durationMinutes: 45 }))).toBe(2);
  });

  it("labels texture from consensus, ownership, then AI fill", () => {
    expect(blockTexture(block({ id: "a", satisfaction: evenly(8) }), members)).toBe("consensus");
    expect(blockTexture(block({ id: "b", satisfaction: evenly(7) }), members)).toBe("consensus");
    // One unhappy member is enough to lose solid green.
    expect(
      blockTexture(block({ id: "c", satisfaction: { ...evenly(9), ben: 2 }, ownerId: "amira" }), members),
    ).toBe("wishlist");
    expect(blockTexture(block({ id: "d", satisfaction: evenly(3) }), members)).toBe("ai-fill");
    expect(blockTexture(block({ id: "e", satisfaction: evenly(9) }), [])).toBe("ai-fill");
  });
});

describe("grid and magnetic snapping", () => {
  it("snaps to the 30-minute grid and clamps inside the day", () => {
    expect(snapToGrid(614)).toBe(600);
    expect(snapToGrid(616)).toBe(630);
    expect(snapToGrid(-40)).toBe(0);
    expect(snapToGrid(DAY_MINUTES + 500)).toBe(DAY_MINUTES);
  });

  it("pulls a block flush against a nearby anchor so meal times are not missed", () => {
    const lunch = block({ id: "lunch", startMinute: 12 * 60, durationMinutes: 60, weight: 9, fixedTime: true });
    const walk = block({ id: "walk", durationMinutes: 90 });

    // Dropped 10 minutes into lunch: snaps to end flush against the start of lunch.
    expect(magneticSnap(11 * 60 + 10, walk, [lunch])).toBe(12 * 60 - 90);
    // Dropped just after lunch ends: snaps flush to the far side.
    expect(magneticSnap(13 * 60 + 10, walk, [lunch])).toBe(13 * 60);
    // Far away: plain grid snap, no magnet.
    expect(magneticSnap(17 * 60 + 5, walk, [lunch])).toBe(17 * 60);
  });

  it("never magnetises a block to itself", () => {
    const self = block({ id: "self", startMinute: 600, durationMinutes: 60, weight: 9, fixedTime: true });
    expect(magneticSnap(605, self, [self])).toBe(600);
  });
});

describe("step 1: rigid anchor locking", () => {
  it("freezes only high-weight fixed-time placed blocks", () => {
    const anchor = block({ id: "show", weight: ANCHOR_WEIGHT_THRESHOLD, fixedTime: true, startMinute: 20 * 60 });
    const looseWeight = block({ id: "loose", weight: 8, fixedTime: true, startMinute: 600 });
    const notFixed = block({ id: "flex", weight: 10, fixedTime: false, startMinute: 600 });
    const unplaced = block({ id: "pool", weight: 10, fixedTime: true, startMinute: null });

    expect(isRigidAnchor(anchor)).toBe(true);
    expect(isRigidAnchor(looseWeight)).toBe(false);
    expect(isRigidAnchor(notFixed)).toBe(false);
    expect(isRigidAnchor(unplaced)).toBe(false);

    const { anchors, pool } = partitionAnchors([anchor, looseWeight, notFixed, unplaced]);
    expect(anchors.map((entry) => entry.id)).toEqual(["show"]);
    expect(pool.map((entry) => entry.id).sort()).toEqual(["flex", "loose", "pool"]);
  });

  it("derives the idle windows anchors leave behind", () => {
    const lunch = block({ id: "lunch", startMinute: 12 * 60, durationMinutes: 60, weight: 9, fixedTime: true });
    const show = block({ id: "show", startMinute: 20 * 60, durationMinutes: 120, weight: 9, fixedTime: true });

    expect(idleWindows([lunch, show], 8 * 60, 23 * 60)).toEqual([
      { startMinute: 480, endMinute: 720 },
      { startMinute: 780, endMinute: 1200 },
      { startMinute: 1320, endMinute: 1380 },
    ]);
  });

  it("drops windows shorter than one slot", () => {
    const first = block({ id: "a", startMinute: 8 * 60, durationMinutes: 60, weight: 9, fixedTime: true });
    const second = block({ id: "b", startMinute: 9 * 60 + 15, durationMinutes: 60, weight: 9, fixedTime: true });
    expect(idleWindows([first, second], 8 * 60, 11 * 60)).toEqual([{ startMinute: 615, endMinute: 660 }]);
  });
});

describe("conflict detection and the trilemma", () => {
  it("finds overlapping pairs and ignores adjacency", () => {
    const first = block({ id: "jonker", startMinute: 600, durationMinutes: 90 });
    const second = block({ id: "cruise", startMinute: 660, durationMinutes: 60 });
    const adjacent = block({ id: "pool", startMinute: 720, durationMinutes: 60 });

    expect(overlapMinutes(first, second)).toBe(30);
    // Back-to-back blocks touch but do not overlap.
    expect(overlapMinutes(second, adjacent)).toBe(0);

    const conflicts = detectConflicts([first, second, adjacent]);
    expect(conflicts).toEqual([{ firstId: "jonker", secondId: "cruise", overlapMinutes: 30 }]);
  });

  it("ignores blocks still sitting in the pool", () => {
    const placed = block({ id: "placed", startMinute: 600, durationMinutes: 60 });
    const pooled = block({ id: "pooled", startMinute: null, durationMinutes: 60 });
    expect(detectConflicts([placed, pooled])).toEqual([]);
  });

  it("offers shorten, replace, and split for a collision", () => {
    const first = block({ id: "jonker", title: "Jonker Street", startMinute: 600, durationMinutes: 90 });
    const second = block({ id: "cruise", title: "River Cruise", startMinute: 660, durationMinutes: 60 });
    const [conflict] = detectConflicts([first, second]);

    expect(trilemmaOptions(conflict, [first, second])).toEqual([
      { kind: "shorten", blockId: "jonker", newDurationMinutes: 60, label: "Shorten Jonker Street" },
      { kind: "replace", blockId: "cruise", label: "Replace River Cruise" },
      { kind: "split", blockIds: ["jonker", "cruise"], label: "Split into two trajectories" },
    ]);
  });

  it("never shortens a block below one slot", () => {
    const first = block({ id: "a", title: "A", startMinute: 600, durationMinutes: 60 });
    const second = block({ id: "b", title: "B", startMinute: 600, durationMinutes: 60 });
    const [conflict] = detectConflicts([first, second]);
    const shorten = trilemmaOptions(conflict, [first, second])[0];
    expect(shorten).toMatchObject({ kind: "shorten", newDurationMinutes: SLOT_MINUTES });
  });

  it("returns nothing when a conflict references a missing block", () => {
    expect(trilemmaOptions({ firstId: "ghost", secondId: "other", overlapMinutes: 10 }, [])).toEqual([]);
  });
});

describe("satisfaction, regret, and fairness", () => {
  it("measures each member against their own best case at the same schedule size", () => {
    const loved = block({ id: "loved", satisfaction: { amira: 10, ben: 2 } });
    const hated = block({ id: "hated", satisfaction: { amira: 1, ben: 9 } });

    const outcome = evaluateTeam([loved], [loved, hated], ["amira", "ben"]);
    const amira = outcome.members.find((entry) => entry.memberId === "amira");
    const ben = outcome.members.find((entry) => entry.memberId === "ben");

    // Amira got her single best block, so zero regret.
    expect(amira).toMatchObject({ achieved: 10, baseline: 10, ratio: 1, regret: 0 });
    // Ben got a 2 when a 9 was available: regret 7.
    expect(ben).toMatchObject({ achieved: 2, baseline: 9, regret: 7 });
    expect(outcome.maxRegret).toBe(7);
    expect(outcome.worstMemberId).toBe("ben");
    expect(outcome.fair).toBe(false);
  });

  it("treats a member with no preferences as satisfied rather than dividing by zero", () => {
    const only = block({ id: "only", satisfaction: { amira: 5 } });
    const outcome = evaluateTeam([only], [only], ["amira", "ghost"]);
    expect(outcome.members.find((entry) => entry.memberId === "ghost")).toMatchObject({ ratio: 1, regret: 0 });
    expect(outcome.fair).toBe(true);
  });

  it("reports zero spread when everyone scores identically", () => {
    const shared = block({ id: "shared", satisfaction: evenly(8) });
    const outcome = evaluateTeam([shared], [shared], members);
    expect(outcome.stdDev).toBe(0);
    expect(outcome.meanRatio).toBe(1);
    expect(outcome.worstMemberId).toBeNull();
  });

  it("handles an empty member list", () => {
    const outcome = evaluateTeam([], [], []);
    expect(outcome).toMatchObject({ total: 0, meanRatio: 1, stdDev: 0, maxRegret: 0, fair: true });
  });
});

describe("step 2: pareto frontier filling", () => {
  const windows = [{ startMinute: 8 * 60, endMinute: 18 * 60 }];

  it("fills idle windows without overlapping anything", () => {
    const pool = [
      block({ id: "jonker", durationMinutes: 90, satisfaction: evenly(8) }),
      block({ id: "museum", durationMinutes: 60, satisfaction: evenly(7) }),
      block({ id: "cruise", durationMinutes: 60, satisfaction: evenly(6) }),
    ];

    const { scheduled, outcome } = paretoFill(pool, windows, members);
    expect(scheduled).toHaveLength(3);
    expect(detectConflicts(scheduled)).toEqual([]);
    expect(outcome.fair).toBe(true);
    // Output is ordered by start time for direct rendering.
    const starts = scheduled.map((entry) => entry.startMinute as number);
    expect(starts).toEqual([...starts].sort((left, right) => left - right));
  });

  it("respects rigid anchors already on the timeline", () => {
    const lunch = block({ id: "lunch", startMinute: 12 * 60, durationMinutes: 60, weight: 9, fixedTime: true });
    const pool = [block({ id: "walk", durationMinutes: 300, satisfaction: evenly(9) })];

    const { scheduled } = paretoFill(pool, idleWindows([lunch], 8 * 60, 18 * 60), members, [lunch]);
    expect(scheduled).toHaveLength(1);
    expect(overlapMinutes(scheduled[0], lunch)).toBe(0);
  });

  it("repairs an unfair fill by swapping in the aggrieved member's block", () => {
    // Three blocks the majority loves and Danish hates, plus one Danish loves.
    const pool = [
      block({ id: "m1", durationMinutes: 60, satisfaction: { amira: 9, ben: 9, chloe: 9, danish: 1 } }),
      block({ id: "m2", durationMinutes: 60, satisfaction: { amira: 9, ben: 9, chloe: 9, danish: 1 } }),
      block({ id: "pool-lounge", durationMinutes: 60, satisfaction: { amira: 2, ben: 2, chloe: 2, danish: 10 } }),
    ];
    const tight = [{ startMinute: 9 * 60, endMinute: 11 * 60 }];

    const { scheduled, outcome } = paretoFill(pool, tight, members);
    expect(scheduled).toHaveLength(2);
    // Danish must not be left merely accompanying the group.
    expect(scheduled.map((entry) => entry.id)).toContain("pool-lounge");
    const danish = outcome.members.find((entry) => entry.memberId === "danish");
    expect(danish?.ratio).toBeGreaterThanOrEqual(MIN_SATISFACTION_RATIO);
  });

  it("reports blocks that cannot fit as unplaced", () => {
    const pool = [
      block({ id: "fits", durationMinutes: 60, satisfaction: evenly(9) }),
      block({ id: "huge", durationMinutes: 600, satisfaction: evenly(9) }),
    ];
    const { scheduled, unplaced } = paretoFill(pool, [{ startMinute: 600, endMinute: 720 }], members);
    expect(scheduled.map((entry) => entry.id)).toEqual(["fits"]);
    expect(unplaced.map((entry) => entry.id)).toEqual(["huge"]);
    expect(unplaced[0].startMinute).toBeNull();
  });

  it("is deterministic across repeated runs", () => {
    const pool = [
      block({ id: "a", durationMinutes: 60, satisfaction: evenly(5) }),
      block({ id: "b", durationMinutes: 60, satisfaction: evenly(5) }),
      block({ id: "c", durationMinutes: 60, satisfaction: evenly(5) }),
    ];
    const first = paretoFill(pool, windows, members).scheduled.map((entry) => entry.id + ":" + entry.startMinute);
    const second = paretoFill(pool, windows, members).scheduled.map((entry) => entry.id + ":" + entry.startMinute);
    expect(first).toEqual(second);
  });

  it("does not mutate the pool it is given", () => {
    const pool = [block({ id: "a", durationMinutes: 60, satisfaction: evenly(5) })];
    paretoFill(pool, windows, members);
    expect(pool[0].startMinute).toBeNull();
  });
});

describe("step 3: round-robin veto", () => {
  const windows = [{ startMinute: 9 * 60, endMinute: 13 * 60 }];

  it("gives every member a turn before anyone gets a second block", () => {
    const pool = [
      block({ id: "amira-1", durationMinutes: 60, satisfaction: { amira: 10, ben: 1, chloe: 1, danish: 1 } }),
      block({ id: "amira-2", durationMinutes: 60, satisfaction: { amira: 9, ben: 1, chloe: 1, danish: 1 } }),
      block({ id: "ben-1", durationMinutes: 60, satisfaction: { amira: 1, ben: 10, chloe: 1, danish: 1 } }),
    ];

    const { scheduled } = roundRobinVeto(pool, windows, ["amira", "ben"]);
    const order = scheduled.map((entry) => entry.id);
    // Amira picks, then Ben picks, before Amira takes a second turn.
    expect(order.slice(0, 2)).toEqual(["amira-1", "ben-1"]);
    expect(order).toHaveLength(3);
  });

  it("collects what never fits into the unaccommodated wish pool", () => {
    const pool = [
      block({ id: "fits", durationMinutes: 60, satisfaction: { amira: 10 } }),
      block({ id: "too-long", durationMinutes: 600, satisfaction: { amira: 9 } }),
    ];
    const { scheduled, wishPool } = roundRobinVeto(pool, [{ startMinute: 600, endMinute: 720 }], ["amira"]);
    expect(scheduled.map((entry) => entry.id)).toEqual(["fits"]);
    expect(wishPool.map((entry) => entry.id)).toEqual(["too-long"]);
    expect(wishPool[0].startMinute).toBeNull();
  });

  it("skips a member with no remaining preference rather than looping forever", () => {
    const pool = [block({ id: "only", durationMinutes: 60, satisfaction: { amira: 8 } })];
    const { scheduled, wishPool } = roundRobinVeto(pool, windows, ["amira", "ghost"]);
    expect(scheduled.map((entry) => entry.id)).toEqual(["only"]);
    expect(wishPool).toEqual([]);
  });
});

describe("step 4: explicit split cut", () => {
  it("cuts when the group is too divided, or when anyone is below the floor", () => {
    const divided = block({ id: "divided", satisfaction: { amira: 10, ben: 1 } });
    const other = block({ id: "other", satisfaction: { amira: 1, ben: 10 } });
    expect(shouldSplitCut(evaluateTeam([divided], [divided, other], ["amira", "ben"]))).toBe(true);
  });

  it("keeps one trajectory when the group agrees", () => {
    const shared = block({ id: "shared", satisfaction: evenly(8) });
    expect(shouldSplitCut(evaluateTeam([shared], [shared], members))).toBe(false);
  });

  it("holds branches to the merge variance at the dinner anchor", () => {
    const dinner = 18 * 60;
    expect(mergeIsPunctual([dinner - 8, dinner + 5], dinner)).toBe(true);
    expect(mergeIsPunctual([dinner - 8, dinner + 25], dinner)).toBe(false);
  });
});
