// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanView } from "@/features/planning/plan-view";
import { proposal, trip, json } from "./planning-fixtures";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PlanView", () => {
  it("shows an honest empty state when nothing has been proposed yet", async () => {
    fetchMock.mockResolvedValueOnce(json({ proposals: [], trip }));
    render(<PlanView tripId="trip-1" canDecideProposals />);
    expect(await screen.findByText(/no itinerary yet/i)).toBeInTheDocument();
    expect(screen.getByText(/ask the assistant in chat/i)).toBeInTheDocument();
  });

  it("renders the active itinerary without a decision", async () => {
    const active = proposal({ id: "active-1", status: "accepted" });
    fetchMock.mockResolvedValueOnce(json({ proposals: [active], trip: { ...trip, activeProposalId: "active-1" } }));
    render(<PlanView tripId="trip-1" canDecideProposals />);
    expect(await screen.findByRole("heading", { name: "Active itinerary" })).toBeInTheDocument();
    expect(screen.getByText("Market visit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
  });

  it("offers accept/reject on a pending proposal and reflects the decision", async () => {
    const user = userEvent.setup();
    const pending = proposal({ id: "pending-1" });
    fetchMock.mockResolvedValueOnce(json({ proposals: [pending], trip }));
    fetchMock.mockResolvedValueOnce(json({ proposal: proposal({ id: "pending-1", status: "accepted" }) }));
    render(<PlanView tripId="trip-1" canDecideProposals />);

    const confirm = await screen.findByRole("button", { name: "Confirm itinerary" });
    await user.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/trips/trip-1/proposals/pending-1/decision",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "accept" }) }),
    ));
    expect(await screen.findByRole("heading", { name: "Active itinerary" })).toBeInTheDocument();
  });

  it("marks a proposal outdated once the trip has moved on to a later revision", async () => {
    const stale = proposal({ id: "stale-1", tripRevision: 1 });
    fetchMock.mockResolvedValueOnce(json({ proposals: [stale], trip: { ...trip, revision: 2 } }));
    render(<PlanView tripId="trip-1" canDecideProposals />);
    expect(await screen.findByText("Outdated")).toBeInTheDocument();
  });

  it("hides decision controls when the caller cannot decide", async () => {
    fetchMock.mockResolvedValueOnce(json({ proposals: [proposal()], trip }));
    render(<PlanView tripId="trip-1" canDecideProposals={false} />);
    await screen.findByText("Market visit");
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
  });
});
