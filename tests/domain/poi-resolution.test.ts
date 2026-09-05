import { describe, expect, it } from "vitest";
import { inferPoiRegion, matchPoiByName, filterCandidatePoisForConstraints, type CandidatePoi } from "@/lib/domain/poi-resolution";
import type { ConfirmedConstraintFlag } from "@/lib/domain/constraint-gate";

describe("inferPoiRegion", () => {
  it.each(["Melaka", "melaka", "Old Town Melaka", "Malacca", "MALACCA"])("matches %s to Old Town/Melaka", (destination) => {
    expect(inferPoiRegion(destination)).toBe("Old Town/Melaka");
  });
  it.each(["KLCC", "klcc", "Kuala Lumpur City Centre", "kuala lumpur city center"])("matches %s to KLCC", (destination) => {
    expect(inferPoiRegion(destination)).toBe("KLCC");
  });
  it.each(["Bukit Bintang", "bukit bintang"])("matches %s to Bukit Bintang", (destination) => {
    expect(inferPoiRegion(destination)).toBe("Bukit Bintang");
  });
  it.each(["Kuala Lumpur", "Tokyo", "Penang", "George Town", ""])("returns null for an unmatched destination %j", (destination) => {
    expect(inferPoiRegion(destination)).toBeNull();
  });
  it("does not match a substring inside an unrelated word", () => {
    expect(inferPoiRegion("Melakaville, a fictional town")).toBeNull();
  });
});

describe("matchPoiByName", () => {
  const seriNyonya: CandidatePoi = {
    name: "Seri Nyonya Restaurant (Hotel Equatorial Melaka)",
    halalStatus: "claimed", allergenRisk: [], allergenDataUnknown: true, dressCode: "none",
  };
  const chengHoonTeng: CandidatePoi = {
    name: "Cheng Hoon Teng Temple",
    halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: true, dressCode: "modest",
  };
  const candidates = [seriNyonya, chengHoonTeng];

  it("matches an exact title", () => {
    expect(matchPoiByName("Cheng Hoon Teng Temple", candidates)).toBe(chengHoonTeng);
  });

  it("matches when the candidate's core name (parenthetical stripped) is a substring of a longer title", () => {
    expect(matchPoiByName("Peranakan dinner at Seri Nyonya Restaurant", candidates)).toBe(seriNyonya);
  });

  it("matches case-insensitively", () => {
    expect(matchPoiByName("SERI NYONYA RESTAURANT visit", candidates)).toBe(seriNyonya);
  });

  it("does not match an unrelated title", () => {
    expect(matchPoiByName("Traditional Peranakan Dinner", candidates)).toBeNull();
  });

  it("does not match the reverse direction (a short title inside a longer candidate name)", () => {
    const longCandidate: CandidatePoi = { name: "A very specific long venue name indeed", halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: true, dressCode: "none" };
    expect(matchPoiByName("A very specific long venue name indeed and more", [longCandidate])).not.toBeNull();
    expect(matchPoiByName("long", [longCandidate])).toBeNull();
  });

  it("ignores a candidate whose core name is too short/generic to be a meaningful signal", () => {
    const generic: CandidatePoi = { name: "Cafe", halalStatus: "verified", allergenRisk: [], allergenDataUnknown: false, dressCode: "none" };
    expect(matchPoiByName("Local Cafe Visit", [generic])).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(matchPoiByName("Anything", [])).toBeNull();
  });
});

describe("filterCandidatePoisForConstraints", () => {
  const verifiedSafe: CandidatePoi = { name: "Verified Safe Spot", halalStatus: "verified", allergenRisk: [], allergenDataUnknown: false, dressCode: "none" };
  const claimedHalal: CandidatePoi = { name: "Claimed Halal Cafe", halalStatus: "claimed", allergenRisk: [], allergenDataUnknown: false, dressCode: "none" };
  const unknownHalal: CandidatePoi = { name: "Unknown Halal Diner", halalStatus: "unknown", allergenRisk: [], allergenDataUnknown: false, dressCode: "none" };
  const noHalal: CandidatePoi = { name: "Non Halal Grill", halalStatus: "no", allergenRisk: [], allergenDataUnknown: false, dressCode: "none" };
  const unknownAllergenData: CandidatePoi = { name: "Verified Mystery Menu", halalStatus: "verified", allergenRisk: [], allergenDataUnknown: true, dressCode: "none" };
  const peanutRisk: CandidatePoi = { name: "Verified Peanut Place", halalStatus: "verified", allergenRisk: ["no_peanut"], allergenDataUnknown: false, dressCode: "none" };
  const all = [verifiedSafe, claimedHalal, unknownHalal, noHalal, unknownAllergenData, peanutRisk];

  function constraint(kind: ConfirmedConstraintFlag["kind"], flag: string, severity: ConfirmedConstraintFlag["severity"] = "severe"): ConfirmedConstraintFlag {
    return { kind, flag, severity };
  }

  it("passes every candidate through when nothing is confirmed", () => {
    expect(filterCandidatePoisForConstraints(all, [])).toEqual(all);
  });

  it("keeps only verified venues when halal is confirmed, regardless of severity", () => {
    const result = filterCandidatePoisForConstraints(all, [constraint("dietary", "halal", "standard")]);
    expect(result).toEqual([verifiedSafe, unknownAllergenData, peanutRisk]);
  });

  it("excludes unknown-allergen-data and matching-risk venues when a severe allergen is confirmed", () => {
    const result = filterCandidatePoisForConstraints(all, [constraint("dietary", "no_peanut", "severe")]);
    expect(result).toEqual([verifiedSafe, claimedHalal, unknownHalal, noHalal]);
  });

  it("does not filter by allergen data at standard severity", () => {
    const result = filterCandidatePoisForConstraints(all, [constraint("dietary", "no_peanut", "standard")]);
    expect(result).toEqual(all);
  });

  it("does not apply halal filtering solely because an allergen constraint is confirmed", () => {
    const result = filterCandidatePoisForConstraints([claimedHalal, unknownHalal], [constraint("dietary", "no_gluten", "severe")]);
    expect(result).toEqual([claimedHalal, unknownHalal]);
  });

  it("does not apply allergen filtering solely because halal is confirmed", () => {
    const result = filterCandidatePoisForConstraints([unknownAllergenData], [constraint("dietary", "halal", "severe")]);
    expect(result).toEqual([unknownAllergenData]);
  });

  it("combines halal and severe-allergen filtering when both are confirmed", () => {
    const result = filterCandidatePoisForConstraints(all, [constraint("dietary", "halal", "severe"), constraint("dietary", "no_peanut", "severe")]);
    expect(result).toEqual([verifiedSafe]);
  });

  it("returns an empty list rather than inventing a fallback when nothing qualifies", () => {
    expect(filterCandidatePoisForConstraints([claimedHalal, unknownHalal, noHalal], [constraint("dietary", "halal", "severe")])).toEqual([]);
  });

  it("ignores non-dietary confirmed constraints", () => {
    const result = filterCandidatePoisForConstraints(all, [constraint("mobility", "wheelchair_accessible_required")]);
    expect(result).toEqual(all);
  });
});
