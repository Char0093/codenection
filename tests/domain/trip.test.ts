import { describe, expect, it } from "vitest";
import { validateTripDates } from "@/lib/domain/trip";

describe("validateTripDates", () => {
  it("accepts a same-day trip", () => expect(validateTripDates("2026-10-03", "2026-10-03")).toBeNull());
  it("rejects an end date before the start", () => expect(validateTripDates("2026-10-04", "2026-10-03")).toContain("end date"));
});
