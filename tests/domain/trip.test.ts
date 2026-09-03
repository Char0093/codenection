import { describe, expect, it } from "vitest";
import { tripInputSchema, validateTripDates } from "@/lib/domain/trip";

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
