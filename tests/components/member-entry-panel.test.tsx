// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberEntryPanel } from "@/components/member-entry-panel";
import type { MemberEntryContext } from "@/app/actions/member-entry";

const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

const tripId = "12345678-1234-4123-8123-123456789012";
const baseContext: MemberEntryContext = {
  preview: {
    organizerName: "Ola", destinationName: "Melaka", startDate: "2026-12-12", endDate: "2026-12-14",
    plannedDurationDays: null, memberCount: 2, proposedBudgetTier: "premium", pace: "active",
  },
  savedSafety: [{ kind: "dietary", flag: "halal" }],
  entry: null,
  alignment: null,
};

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("MemberEntryPanel", () => {
  it("renders the organizer preview", () => {
    render(<MemberEntryPanel tripId={tripId} initial={baseContext} />);
    expect(screen.getByText("Ola")).toBeInTheDocument();
    expect(screen.getByText(/Melaka/)).toBeInTheDocument();
    expect(screen.getByText(/2 members/)).toBeInTheDocument();
  });

  it("hides the alignment section when there is no summary", () => {
    render(<MemberEntryPanel tripId={tripId} initial={baseContext} />);
    expect(screen.queryByText(/aggregated across/i)).not.toBeInTheDocument();
  });

  it("shows the alignment summary with no member identifiers", () => {
    render(<MemberEntryPanel tripId={tripId} initial={{
      ...baseContext,
      alignment: {
        memberCount: 3, budget: { min: "budget", max: "premium" },
        pace: { relaxed: 1, balanced: 2, active: 0, intense: 0 },
        availability: { full: 2, partial: 1 },
        safetyOverrides: [{ kind: "dietary", flag: "halal", count: 1 }],
      },
    }} />);
    expect(screen.getByText(/aggregated across 3 members/i)).toBeInTheDocument();
    const section = screen.getByTestId("alignment-summary");
    expect(section.textContent).not.toMatch(/Ola|user|member.?id/i);
  });

  it("blocks submit until part-trip availability has a date, then posts a full-trip entry", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    render(<MemberEntryPanel tripId={tripId} initial={baseContext} />);

    await user.click(screen.getByRole("radio", { name: /part of it/i }));
    expect(screen.getByRole("button", { name: /save your preferences/i })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /whole trip/i }));
    const submit = screen.getByRole("button", { name: /save your preferences/i });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/trips/${tripId}/member-entry`);
    expect(lastBody()).toEqual({
      availability: { coverage: "full", arrivalDate: null, departureDate: null },
      budgetTier: "standard",
      pace: "balanced",
      safetyOverrides: [],
    });
  });

  it("moves an unchecked saved safety flag into safetyOverrides", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    render(<MemberEntryPanel tripId={tripId} initial={baseContext} />);
    await user.click(screen.getByRole("checkbox", { name: /halal.*applies to this trip/i }));
    await user.click(screen.getByRole("button", { name: /save your preferences/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody().safetyOverrides).toEqual([{ kind: "dietary", flag: "halal" }]);
  });

  it("surfaces a server error and does not show Saved", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ error: "Some of your trip answers were invalid.", code: "INVALID_MEMBER_ENTRY" }, 422));
    render(<MemberEntryPanel tripId={tripId} initial={baseContext} />);
    await user.click(screen.getByRole("button", { name: /save your preferences/i }));
    expect(await screen.findByText(/invalid/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
