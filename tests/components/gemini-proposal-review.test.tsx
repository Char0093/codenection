// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GeminiProposalReview } from "@/components/gemini-proposal-review";
import { proposal } from "./planning-fixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("renders dated activities, assumptions, rationale, and contingency notes", () => {
  render(<GeminiProposalReview proposal={proposal()} canDecide onDecision={vi.fn()} />);
  for (const text of ["2026-10-03", "09:00", "Market visit", "Local transport available", "Time for local food", "Covered market nearby"])
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
});
it.each(["accepted", "rejected", "expired"] as const)("does not offer decisions for %s proposals", (status) => {
  render(<GeminiProposalReview proposal={proposal({ status })} canDecide onDecision={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
});
it("expires a pending proposal while the page is open", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T00:00:00Z"));
  render(<GeminiProposalReview proposal={proposal({ expiresAt: "2026-09-03T00:00:01Z" })} canDecide onDecision={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeEnabled();
  act(() => { vi.advanceTimersByTime(1100); });
  expect(screen.getByText("Expired")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
});
