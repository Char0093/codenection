import { describe, expect, it } from "vitest";
import { evaluateConstraintGate, type ConfirmedConstraintFlag, type GateItem, type TravelerConstraintProfile } from "@/lib/domain/constraint-gate";

const noConstraints: ConfirmedConstraintFlag[] = [];
const noCaps: TravelerConstraintProfile[] = [];

function foodItem(overrides: Partial<GateItem> = {}): GateItem {
  return { category: "food", estimatedCost: 20, ...overrides };
}
function cultureItem(overrides: Partial<GateItem> = {}): GateItem {
  return { category: "culture", estimatedCost: 20, ...overrides };
}

describe("dietary (allergens)", () => {
  it("passes a food item with no matching allergen and known data", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_peanut", severity: "severe" }];
    const item = foodItem({ allergenRisk: ["no_shellfish"], allergenDataUnknown: false });
    expect(evaluateConstraintGate(item, constraints, noCaps).result).toBe("pass");
  });

  it("fails when the item's allergen_risk lists a confirmed allergen, regardless of severity", () => {
    const severe: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_peanut", severity: "severe" }];
    const standard: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_gluten", severity: "standard" }];
    const itemPeanut = foodItem({ allergenRisk: ["no_peanut"], allergenDataUnknown: false });
    const itemGluten = foodItem({ allergenRisk: ["no_gluten"], allergenDataUnknown: false });
    expect(evaluateConstraintGate(itemPeanut, severe, noCaps).result).toBe("fail");
    expect(evaluateConstraintGate(itemGluten, standard, noCaps).result).toBe("fail");
  });

  it("fails closed on unknown allergen data for a severe flag", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_peanut", severity: "severe" }];
    const item = foodItem({ allergenDataUnknown: true });
    const outcome = evaluateConstraintGate(item, constraints, noCaps);
    expect(outcome.result).toBe("fail");
    expect(outcome.reasons.some((r) => r.dimension === "dietary")).toBe(true);
  });

  it("warns (does not fail) on unknown allergen data for a standard flag", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_gluten", severity: "standard" }];
    const item = foodItem({ allergenDataUnknown: true });
    expect(evaluateConstraintGate(item, constraints, noCaps).result).toBe("warn");
  });

  it("treats a missing allergenRisk field as unknown data", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_peanut", severity: "severe" }];
    const item = foodItem();
    expect(evaluateConstraintGate(item, constraints, noCaps).result).toBe("fail");
  });

  it("ignores dietary constraints for non-food items", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "no_peanut", severity: "severe" }];
    const item = cultureItem();
    expect(evaluateConstraintGate(item, constraints, noCaps).result).toBe("pass");
  });

  it("does not enforce non-allergen dietary flags like vegetarian/vegan/other (out of Section VII's stated scope)", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "vegetarian", severity: "standard" }];
    const item = foodItem({ allergenDataUnknown: true });
    expect(evaluateConstraintGate(item, constraints, noCaps).result).toBe("pass");
  });
});

describe("halal", () => {
  const halalConfirmed: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "halal", severity: "standard" }];

  it("passes a verified-halal food item", () => {
    const item = foodItem({ halalStatus: "verified" });
    expect(evaluateConstraintGate(item, halalConfirmed, noCaps).result).toBe("pass");
  });

  it("warns on a claimed-only halal status", () => {
    const item = foodItem({ halalStatus: "claimed" });
    expect(evaluateConstraintGate(item, halalConfirmed, noCaps).result).toBe("warn");
  });

  it.each(["unknown", "no"] as const)("fails on halal_status = %s", (status) => {
    const item = foodItem({ halalStatus: status });
    expect(evaluateConstraintGate(item, halalConfirmed, noCaps).result).toBe("fail");
  });

  it("fails when halalStatus is absent (treated as unknown)", () => {
    const item = foodItem();
    expect(evaluateConstraintGate(item, halalConfirmed, noCaps).result).toBe("fail");
  });

  it("does not check halal when it is not a confirmed constraint", () => {
    const item = foodItem({ halalStatus: "no" });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("pass");
  });

  it("does not check halal for non-food items even if confirmed", () => {
    const item = cultureItem();
    expect(evaluateConstraintGate(item, halalConfirmed, noCaps).result).toBe("pass");
  });
});

describe("dress code", () => {
  it("warns (never silently schedules) a modest-dress item", () => {
    const item = cultureItem({ dressCode: "modest" });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("warn");
  });

  it("passes an item with no dress code requirement", () => {
    const item = cultureItem({ dressCode: "none" });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("pass");
  });

  it("passes when dressCode is absent", () => {
    expect(evaluateConstraintGate(cultureItem(), noConstraints, noCaps).result).toBe("pass");
  });
});

describe("budget", () => {
  it("passes when the item's cost is within every affected traveler's remaining budget", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: 100, mobilityThresholdM: null }];
    const item = cultureItem({ estimatedCost: 50 });
    expect(evaluateConstraintGate(item, noConstraints, caps).result).toBe("pass");
  });

  it("fails when the item's cost exceeds any affected traveler's remaining budget (upper bound)", () => {
    const caps: TravelerConstraintProfile[] = [
      { tripMemberId: "m1", remainingBudget: 100, mobilityThresholdM: null },
      { tripMemberId: "m2", remainingBudget: 10, mobilityThresholdM: null },
    ];
    const item = cultureItem({ estimatedCost: 50 });
    const outcome = evaluateConstraintGate(item, noConstraints, caps);
    expect(outcome.result).toBe("fail");
    expect(outcome.reasons.some((r) => r.dimension === "budget" && r.message.includes("m2"))).toBe(true);
  });

  it("passes exactly at the cap boundary (cost equal to remaining budget)", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: 50, mobilityThresholdM: null }];
    const item = cultureItem({ estimatedCost: 50 });
    expect(evaluateConstraintGate(item, noConstraints, caps).result).toBe("pass");
  });

  it("ignores a traveler with no budget cap set", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: null }];
    const item = cultureItem({ estimatedCost: 1_000_000 });
    expect(evaluateConstraintGate(item, noConstraints, caps).result).toBe("pass");
  });
});

describe("mobility", () => {
  it("passes a leg within every affected traveler's mobility threshold", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: 500 }];
    const item = cultureItem({ legDistanceM: 400 });
    expect(evaluateConstraintGate(item, noConstraints, caps).result).toBe("pass");
  });

  it("fails a leg exceeding threshold when a severe mobility constraint is confirmed", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "mobility", flag: "wheelchair_accessible_required", severity: "severe" }];
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: 500 }];
    const item = cultureItem({ legDistanceM: 600 });
    expect(evaluateConstraintGate(item, constraints, caps).result).toBe("fail");
  });

  it("warns (does not fail) a leg exceeding threshold when the mobility constraint is standard severity", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "mobility", flag: "limited_walking_distance", severity: "standard" }];
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: 500 }];
    const item = cultureItem({ legDistanceM: 600 });
    expect(evaluateConstraintGate(item, constraints, caps).result).toBe("warn");
  });

  it("warns on a threshold breach with no confirmed mobility severity on record", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: 500 }];
    const item = cultureItem({ legDistanceM: 600 });
    expect(evaluateConstraintGate(item, noConstraints, caps).result).toBe("warn");
  });

  it("ignores a traveler with no mobility threshold set", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: null }];
    const item = cultureItem({ legDistanceM: 100_000 });
    expect(evaluateConstraintGate(item, noConstraints, caps).result).toBe("pass");
  });

  it("ignores mobility entirely when legDistanceM is not provided", () => {
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: null, mobilityThresholdM: 10 }];
    expect(evaluateConstraintGate(cultureItem(), noConstraints, caps).result).toBe("pass");
  });
});

describe("time", () => {
  it("fails on overlap with the preceding activity", () => {
    const item = cultureItem({ overlapsPrecedingActivity: true });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("fail");
  });

  it("fails on crossing the midnight boundary", () => {
    const item = cultureItem({ crossesMidnight: true });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("fail");
  });

  it("fails on missing the consensus anchor arrival", () => {
    const item = cultureItem({ missesConsensusAnchorArrival: true });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("fail");
  });

  it("passes when missesConsensusAnchorArrival is null (not applicable pre-Phase-4)", () => {
    const item = cultureItem({ missesConsensusAnchorArrival: null });
    expect(evaluateConstraintGate(item, noConstraints, noCaps).result).toBe("pass");
  });

  it("passes a clean item with no time flags set", () => {
    expect(evaluateConstraintGate(cultureItem(), noConstraints, noCaps).result).toBe("pass");
  });
});

describe("aggregate severity", () => {
  it("fail outranks warn outranks pass across multiple simultaneous dimensions", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "halal", severity: "standard" }];
    const item = foodItem({ halalStatus: "claimed", dressCode: "modest" });
    const outcome = evaluateConstraintGate(item, constraints, noCaps);
    // claimed halal -> warn; dress code -> warn; overall still warn (no fail present)
    expect(outcome.result).toBe("warn");
    expect(outcome.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("a single failing dimension makes the whole outcome fail even alongside warns", () => {
    const constraints: ConfirmedConstraintFlag[] = [{ kind: "dietary", flag: "halal", severity: "standard" }];
    const item = foodItem({ halalStatus: "claimed", dressCode: "modest", crossesMidnight: true });
    expect(evaluateConstraintGate(item, constraints, noCaps).result).toBe("fail");
  });

  it("collects reasons from every violated dimension, not just the first", () => {
    const constraints: ConfirmedConstraintFlag[] = [
      { kind: "dietary", flag: "no_peanut", severity: "severe" },
      { kind: "mobility", flag: "wheelchair_accessible_required", severity: "severe" },
    ];
    const caps: TravelerConstraintProfile[] = [{ tripMemberId: "m1", remainingBudget: 5, mobilityThresholdM: 100 }];
    const item = foodItem({ allergenDataUnknown: true, estimatedCost: 50, legDistanceM: 200 });
    const outcome = evaluateConstraintGate(item, constraints, caps);
    expect(outcome.result).toBe("fail");
    const dims = outcome.reasons.map((r) => r.dimension).sort();
    expect(dims).toEqual(["budget", "dietary", "mobility"]);
  });
});
