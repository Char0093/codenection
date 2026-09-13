import { describe, expect, it } from "vitest";
import { buildPlanActivities } from "@/lib/prototype/build-plan-activities";
import { DEMO_POOL, type DemoBlock } from "@/lib/prototype/fixtures";

function block(overrides: Partial<DemoBlock> = {}): DemoBlock {
  return {
    id: "x1", title: "Test stop", category: "culture", date: "2026-10-03",
    startMinute: 9 * 60, durationMinutes: 60, ...overrides,
  };
}

describe("buildPlanActivities", () => {
  it("maps a block's schedule, rationale, contingency note, and location onto an activity", () => {
    const [activity] = buildPlanActivities([block({
      title: "Street of Harmony walk", rationale: "An easy orientation to the old town.",
      contingencyNote: "Closes at prayer times.", location: "Lebuh Acheh, George Town",
    })]);
    expect(activity).toMatchObject({
      title: "Street of Harmony walk", date: "2026-10-03", startTime: "09:00", durationMinutes: 60,
      rationale: "An easy orientation to the old town.", contingencyNote: "Closes at prayer times.",
      location: "Lebuh Acheh, George Town",
    });
  });

  it("sorts activities by date then start time", () => {
    const activities = buildPlanActivities([
      block({ id: "a", title: "Day2 morning", date: "2026-10-04", startMinute: 8 * 60 }),
      block({ id: "b", title: "Day1 afternoon", date: "2026-10-03", startMinute: 15 * 60 }),
      block({ id: "c", title: "Day1 morning", date: "2026-10-03", startMinute: 9 * 60 }),
    ]);
    expect(activities.map((a) => a.title)).toEqual(["Day1 morning", "Day1 afternoon", "Day2 morning"]);
  });

  it("falls back to the pool item's blurb, cost tier, and location when a block has none of its own", () => {
    const poolItem = DEMO_POOL.find((p) => p.id === "p1")!;
    const [activity] = buildPlanActivities([block({ title: poolItem.name, poolId: "p1" })]);
    expect(activity.rationale).toBe(poolItem.blurb);
    expect(activity.estimatedCostTier).toBe(poolItem.costTier);
    expect(activity.location).toBe(poolItem.location);
  });

  it("defaults cost tier and rationale when a block is neither pool-sourced nor pre-written", () => {
    const [activity] = buildPlanActivities([block()]);
    expect(activity.estimatedCostTier).toBe("standard");
    expect(activity.rationale).toBe("Added while planning the trip.");
  });

  it("uses a seeded block's own cost tier instead of the pool/default fallback", () => {
    const [activity] = buildPlanActivities([block({ estimatedCostTier: "budget" })]);
    expect(activity.estimatedCostTier).toBe("budget");
  });

  it("renders a split block as two activities sharing the slot, each noting the other", () => {
    const activities = buildPlanActivities([block({
      title: "Hawker lunch, Chulia Street",
      split: { title: "Gurney Drive hawker stalls", category: "food", poolId: "p2" },
    })]);
    expect(activities).toHaveLength(2);
    expect(activities[0].title).toBe("Hawker lunch, Chulia Street");
    expect(activities[1].title).toBe("Gurney Drive hawker stalls");
    expect(activities[0].date).toBe(activities[1].date);
    expect(activities[0].startTime).toBe(activities[1].startTime);
    expect(activities[0].contingencyNote).toMatch(/Sharing this time slot with Gurney Drive hawker stalls/);
    expect(activities[1].contingencyNote).toMatch(/Sharing this time slot with Hawker lunch, Chulia Street/);
  });

  it("appends the shared-slot note after an existing contingency note instead of replacing it", () => {
    const [activity] = buildPlanActivities([block({
      contingencyNote: "Guided entry only.",
      split: { title: "Wonderfood Museum", category: "culture" },
    })]);
    expect(activity.contingencyNote).toBe(
      "Guided entry only. Sharing this time slot with Wonderfood Museum — the group hasn't chosen between them yet.",
    );
  });
});
