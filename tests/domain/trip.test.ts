import { describe, expect, it } from "vitest";
import {
  tripInputSchema, validateTripDates, isTripReady,
  createTripFrameSchema, frameEnablesChat, TRIP_MODES,
} from "@/lib/domain/trip";

const input = {
  destinationName: " George Town ", startDate: "2026-10-03", endDate: "2026-10-05",
  budgetTier: "standard", pace: "balanced", notes: " Food markets and short transfers. ",
};

describe("tripInputSchema", () => {
  it("trims ordinary trip fields", () => {
    expect(tripInputSchema.parse(input)).toEqual({ ...input, destinationName: "George Town", notes: "Food markets and short transfers." });
  });
  it("allows omitted notes and the inclusive 14-day limit", () => {
    expect(tripInputSchema.parse({ ...input, startDate: "2026-10-01", endDate: "2026-10-14", notes: undefined }).notes).toBeUndefined();
  });
  it.each([
    { destinationName: " " }, { destinationName: "x".repeat(121) }, { notes: "x".repeat(1001) },
    { budgetTier: "value" }, { pace: "full" }, { startDate: "2026-10-06" },
    { startDate: "2026-10-01", endDate: "2026-10-15" }, { members: [] }, { name: "legacy" },
  ])("rejects invalid or extra input %j", (patch) => {
    expect(tripInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it.each([
    "I have diabetes", "Sam uses a wheelchair", "Ana has a severe peanut allergy",
    "I am Muslim", "Jo is Christian", "My medication requires refrigeration",
    "One member has a disability", "I have asthma", "We need an EpiPen",
    "Lee is autistic", "Sam is deaf", "We have anaphylaxis risk",
    "Alice's religion is Hinduism", "I suffer from chronic pain", "My medical condition",
    "Alice: Muslim", "I follow Islam", "Our group includes two Muslims",
    "Sam has limited mobility", "I have celiac disease", "My friend has bipolar disorder",
  ])("rejects likely sensitive notes: %s", (notes) => {
    const result = tripInputSchema.safeParse({ ...input, notes });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain("sensitive personal");
  });
  it.each(["Visit temples and museums", "Vegetarian food and low walking on day one", "Explore Islamic architecture", "Try halal food markets"])("allows ordinary preferences: %s", (notes) => {
    expect(tripInputSchema.safeParse({ ...input, notes }).success).toBe(true);
  });
  it("also checks destination text to avoid bypassing the notes guard", () => {
    expect(tripInputSchema.safeParse({ ...input, destinationName: "Penang, I have diabetes" }).success).toBe(false);
  });
});

describe("validateTripDates", () => {
  it("accepts a same-day trip and a real leap day", () => {
    expect(validateTripDates("2026-10-03", "2026-10-03")).toBeNull();
    expect(validateTripDates("2028-02-29", "2028-03-01")).toBeNull();
  });
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-1-03", "2026-10-03T00:00:00Z", "0000-01-01", "invalid"])("rejects a non-calendar date %s", (date) => {
    expect(validateTripDates(date, "2026-10-03")).toContain("YYYY-MM-DD");
    expect(validateTripDates("2026-10-03", date)).toContain("YYYY-MM-DD");
  });
  it("rejects reversed and oversized ranges", () => {
    expect(validateTripDates("2026-10-04", "2026-10-03")).toContain("end date");
    expect(validateTripDates("2026-10-01", "2026-10-15")).toContain("14 days");
  });
});

describe("createTripFrameSchema (organizer trip frame)", () => {
  const base = {
    name: "Melaka crew", destinationName: "Melaka", tripMode: "balanced" as const,
    proposedBudgetTier: null, splitAllowed: false,
  };

  it("accepts an explicit date pair within 14 days", () => {
    const p = createTripFrameSchema.parse({ ...base, startDate: "2026-12-12", endDate: "2026-12-14" });
    expect(p).toMatchObject({ name: "Melaka crew", destinationName: "Melaka", tripMode: "balanced" });
  });
  it("trims the name + destination and defaults the optional fields", () => {
    const p = createTripFrameSchema.parse({
      name: "  Melaka crew  ", destinationName: "  Melaka  ", tripMode: "relaxed", plannedDurationDays: 4,
    });
    expect(p).toMatchObject({ name: "Melaka crew", destinationName: "Melaka", proposedBudgetTier: null, splitAllowed: false });
  });
  it("accepts a duration-only frame (1..14 days) with no dates", () => {
    expect(createTripFrameSchema.parse({ ...base, plannedDurationDays: 5 }).plannedDurationDays).toBe(5);
  });
  it("accepts an optional proposed budget tier and split flag", () => {
    const p = createTripFrameSchema.parse({ ...base, plannedDurationDays: 4, proposedBudgetTier: "premium", splitAllowed: true });
    expect(p).toMatchObject({ proposedBudgetTier: "premium", splitAllowed: true });
  });
  it.each([
    ["neither dates nor duration", { ...base }],
    ["an inverted date range", { ...base, startDate: "2026-12-14", endDate: "2026-12-12" }],
    ["a >14-day range", { ...base, startDate: "2026-12-01", endDate: "2026-12-30" }],
    ["only a start date", { ...base, startDate: "2026-12-12" }],
    ["duration 0", { ...base, plannedDurationDays: 0 }],
    ["duration 15", { ...base, plannedDurationDays: 15 }],
    ["an unknown mode", { ...base, tripMode: "party", plannedDurationDays: 3 }],
    ["a blank destination", { ...base, destinationName: "  ", plannedDurationDays: 3 }],
    ["an extra key", { ...base, plannedDurationDays: 3, foo: 1 }],
  ])("rejects %s", (_label, value) => {
    expect(createTripFrameSchema.safeParse(value).success).toBe(false);
  });
  it("applies the sensitive-data guard to the name and destination", () => {
    expect(createTripFrameSchema.safeParse({ ...base, plannedDurationDays: 3, name: "Trip for people with diabetes" }).success).toBe(false);
    expect(createTripFrameSchema.safeParse({ ...base, plannedDurationDays: 3, destinationName: "Melaka, I have asthma" }).success).toBe(false);
  });
});

describe("frameEnablesChat", () => {
  it("is true once destination + mode + (dates or duration) exist", () => {
    expect(frameEnablesChat({ destinationName: "Melaka", tripMode: "balanced", startDate: null, endDate: null, plannedDurationDays: 3 })).toBe(true);
    expect(frameEnablesChat({ destinationName: "Melaka", tripMode: "balanced", startDate: "2026-12-12", endDate: "2026-12-14", plannedDurationDays: null })).toBe(true);
  });
  it.each([
    { destinationName: null, tripMode: "balanced", startDate: "2026-12-12", endDate: "2026-12-14", plannedDurationDays: null },
    { destinationName: "Melaka", tripMode: null, startDate: "2026-12-12", endDate: "2026-12-14", plannedDurationDays: null },
    { destinationName: "Melaka", tripMode: "balanced", startDate: null, endDate: null, plannedDurationDays: null },
  ])("is false with a missing destination, mode, or time frame %j", (fields) => {
    expect(frameEnablesChat(fields)).toBe(false);
  });
});

it("exposes exactly the four trip modes", () => {
  expect([...TRIP_MODES]).toEqual(["relaxed", "balanced", "adventurous", "mixed"]);
});

describe("isTripReady", () => {
  it("is true only with a destination and a valid date range", () => {
    expect(isTripReady({ destinationName: "Melaka", startDate: "2026-12-12", endDate: "2026-12-14" })).toBe(true);
  });
  it.each([
    { destinationName: null, startDate: "2026-12-12", endDate: "2026-12-14" },
    { destinationName: "  ", startDate: "2026-12-12", endDate: "2026-12-14" },
    { destinationName: "Melaka", startDate: null, endDate: "2026-12-14" },
    { destinationName: "Melaka", startDate: "2026-12-12", endDate: null },
    { destinationName: "Melaka", startDate: "2026-12-14", endDate: "2026-12-12" },
    { destinationName: "Melaka", startDate: "2026-13-01", endDate: "2026-13-02" },
  ])("is false while draft or invalid %j", (fields) => {
    expect(isTripReady(fields)).toBe(false);
  });
});
