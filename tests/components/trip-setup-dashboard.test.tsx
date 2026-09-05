// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripSetupDashboard } from "@/components/trip-setup-dashboard";
import { json, proposal, trip } from "./planning-fixtures";

const { listMessages, sendMessage, openChatChannel } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  sendMessage: vi.fn(),
  openChatChannel: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/chat/repository", () => ({ listMessages, sendMessage }));
vi.mock("@/lib/realtime/channel", () => ({ openChatChannel }));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/");
  listMessages.mockResolvedValue([]);
  openChatChannel.mockImplementation(() => ({ close: vi.fn() }));
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset();
  listMessages.mockReset(); sendMessage.mockReset(); openChatChannel.mockReset();
});

function load(record = trip, proposals = [] as ReturnType<typeof proposal>[]) {
  fetchMock.mockResolvedValueOnce(json({ trips: [record] })).mockResolvedValueOnce(json({ trip: record, proposals }));
  render(<TripSetupDashboard email="owner@example.com" />);
  return screen.findByDisplayValue(record.destinationName);
}

describe("trip workspace", () => {
  it("loads real trips and exposes exactly the four scoped tabs", async () => {
    await load();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Trip Setup", "Plan", "Timeline", "Chat"]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/trips", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.queryByText(/people|profile|provider health|weather|consent|quiz|discovery|plan b/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(screen.getByRole("button", { name: "Sign out" }).closest("form")).toHaveAttribute("action", "/auth/signout");
  });

  it("saves the edited inputs before generating, then confirms the returned proposal", async () => {
    const user = userEvent.setup();
    await load();
    await user.clear(screen.getByLabelText("Destination"));
    await user.type(screen.getByLabelText("Destination"), "Ipoh");
    fetchMock.mockResolvedValueOnce(json({ trip: { ...trip, destinationName: "Ipoh", revision: 2 } }))
      .mockResolvedValueOnce(json({ proposal: proposal({ tripRevision: 2 }) }));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByText("Market visit")).toBeInTheDocument();
    expect(fetchMock.mock.calls[2][0]).toBe("/api/trips/trip-1");
    expect(fetchMock.mock.calls[2][1]?.method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual({
      destinationName: "Ipoh", startDate: trip.startDate, endDate: trip.endDate,
      budgetTier: trip.budgetTier, pace: trip.pace, notes: trip.notes,
    });
    expect(fetchMock.mock.calls[3][0]).toBe("/api/trips/trip-1/proposals");
    expect(fetchMock.mock.calls[3][1]?.body).toBeUndefined();
    fetchMock.mockResolvedValueOnce(json({ proposal: proposal({ status: "accepted", tripRevision: 2 }) }));
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    expect(await screen.findByRole("heading", { name: "Active itinerary" })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[4][1]?.body as string)).toEqual({ decision: "accept" });
  });

  it("creates a new trip without sample defaults", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ trips: [] }));
    render(<TripSetupDashboard email="owner@example.com" />);
    await waitFor(() => expect(screen.getByLabelText("Destination")).toBeEnabled());
    expect(screen.getByLabelText("Destination")).toHaveValue("");
    await user.type(screen.getByLabelText("Destination"), "Penang");
    await user.type(screen.getByLabelText("Start date"), "2026-10-03");
    await user.type(screen.getByLabelText("End date"), "2026-10-04");
    fetchMock.mockResolvedValueOnce(json({ trip }));
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    expect(await screen.findByText("Trip saved.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/trips");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
  });

  it("keeps the active itinerary during generation and failure and locks competing actions", async () => {
    const user = userEvent.setup();
    const active = proposal({ id: "active", status: "accepted" });
    await load({ ...trip, activeProposalId: active.id }, [active]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByRole("heading", { name: "Active itinerary" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Trip Setup" }));
    let finish!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(json({ trip: { ...trip, activeProposalId: active.id } }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    await screen.findByText("Generating proposal...");
    expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
    expect(screen.getByLabelText("Recent trips")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save trip" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByText("Market visit")).toBeVisible();
    finish(json({ error: "Generation unavailable" }, 503));
    expect(await screen.findByRole("alert")).toHaveTextContent("Generation unavailable");
    expect(screen.getByText("Market visit")).toBeVisible();
  });

  it.each(["member", "viewer"] as const)("prevents %s updates, generation and decisions", async (role) => {
    const user = userEvent.setup();
    await load({ ...trip, role }, [proposal()]);
    expect(screen.getByLabelText("Destination")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("allows planner generation but not owner decisions", async () => {
    const user = userEvent.setup();
    await load({ ...trip, role: "planner" }, [proposal()]);
    expect(screen.getByRole("button", { name: "Generate plan" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
  });

  it("does not generate after a save validation error", async () => {
    const user = userEvent.setup();
    await load();
    fetchMock.mockResolvedValueOnce(json({ error: "Trip dates are invalid", code: "VALIDATION_ERROR" }, 400));
    await user.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trip dates are invalid");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("selects a linked trip, preserves its active plan, and rejects a pending proposal", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?trip=linked");
    const linked = { ...trip, id: "linked", activeProposalId: "active" };
    fetchMock.mockResolvedValueOnce(json({ trips: [trip, linked] })).mockResolvedValueOnce(json({
      trip: linked, proposals: [proposal({ tripId: "linked" }), proposal({ id: "active", tripId: "linked", status: "accepted" })],
    }));
    render(<TripSetupDashboard email="owner@example.com" />);
    await screen.findByDisplayValue("Penang");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/trips/linked");
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    fetchMock.mockResolvedValueOnce(json({ proposal: proposal({ tripId: "linked", status: "rejected" }) }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Active itinerary" })).getByText("Market visit")).toBeVisible();
  });

  it("offers retry after list failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<TripSetupDashboard email="owner@example.com" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    fetchMock.mockResolvedValueOnce(json({ trips: [trip] })).mockResolvedValueOnce(json({ trip, proposals: [] }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByDisplayValue("Penang")).toBeInTheDocument();
  });

  it("matches the server input limits", async () => {
    await load();
    expect(screen.getByLabelText("Destination")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Group notes")).toHaveAttribute("maxlength", "1000");
  });

  it("expires competing pending proposals after confirmation", async () => {
    const user = userEvent.setup();
    await load(trip, [proposal(), proposal({ id: "older" })]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    fetchMock.mockResolvedValueOnce(json({ proposal: proposal({ status: "accepted" }) }));
    await user.click(screen.getAllByRole("button", { name: "Confirm itinerary" })[0]);
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
  });

  it("allows the owner to reject an outdated pending proposal", async () => {
    const user = userEvent.setup();
    await load({ ...trip, revision: 2 }, [proposal()]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(json({ proposal: proposal({ status: "rejected" }) }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
  });

  it("preserves a pending proposal and active itinerary after a failed decision", async () => {
    const user = userEvent.setup();
    await load({ ...trip, activeProposalId: "active" }, [proposal(), proposal({ id: "active", status: "accepted" })]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New trip" })).toBeDisabled();
    finish(json({ error: "Confirmation failed" }, 500));
    expect(await screen.findByRole("alert")).toHaveTextContent("The decision may have been saved. Reload trip before making another decision.");
    expect(screen.getByRole("region", { name: "Active itinerary" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reload trip" })).toBeEnabled();
  });

  it("locks switching until detail resolves, then replaces all trip state together", async () => {
    const user = userEvent.setup();
    const second = { ...trip, id: "second", destinationName: "Ipoh", role: "viewer" as const };
    fetchMock.mockResolvedValueOnce(json({ trips: [trip, second] })).mockResolvedValueOnce(json({ trip, proposals: [proposal()] }));
    render(<TripSetupDashboard email="owner@example.com" />);
    await screen.findByDisplayValue("Penang");
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.selectOptions(screen.getByLabelText("Recent trips"), "second");
    expect(screen.getByLabelText("Recent trips")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    expect(screen.getByLabelText("Destination")).toHaveValue("Penang");
    finish(json({ trip: second, proposals: [] }));
    await screen.findByDisplayValue("Ipoh");
    expect(screen.getByLabelText("Destination")).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    expect(screen.queryByText("Market visit")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("trip")).toBe("second");
  });

  it("ignores a late detail response after unmount", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(json({ trips: [trip] }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const mounted = render(<TripSetupDashboard email="owner@example.com" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const signal = fetchMock.mock.calls[1][1]?.signal;
    mounted.unmount();
    expect(signal?.aborted).toBe(true);
    window.history.replaceState(null, "", "/?trip=new-selection");
    await act(async () => { finish(json({ trip, proposals: [proposal()] })); });
    expect(new URLSearchParams(window.location.search).get("trip")).toBe("new-selection");
    expect(screen.queryByText("Market visit")).not.toBeInTheDocument();
  });

  it.each([404, 422])("recovers from an unavailable linked trip (%s) by selecting a recent trip", async (status) => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?trip=unavailable");
    fetchMock.mockResolvedValueOnce(json({ trips: [trip] }))
      .mockResolvedValueOnce(json({ error: "Trip not found" }, status));
    render(<TripSetupDashboard email="owner@example.com" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Selected trip is unavailable");
    expect(screen.getByLabelText("Recent trips")).toBeEnabled();
    expect(screen.getByRole("button", { name: "New trip" })).toBeEnabled();
    expect(screen.getByLabelText("Destination")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    expect(window.location.search).toBe("?trip=unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(json({ trip, proposals: [] }));
    await user.selectOptions(screen.getByLabelText("Recent trips"), trip.id);
    expect(await screen.findByDisplayValue("Penang")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?trip=trip-1");
  });

  it("allows explicit new-trip recovery from a deleted link even with no recent trips", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?trip=deleted");
    fetchMock.mockResolvedValueOnce(json({ trips: [] })).mockResolvedValueOnce(json({ error: "Not found" }, 404));
    render(<TripSetupDashboard email="owner@example.com" />);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "New trip" }));
    expect(screen.getByLabelText("Destination")).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it.each(["edit", "accept"] as const)("reconciles a decision conflict caused by another session's %s", async (change) => {
    const user = userEvent.setup();
    const previous = proposal({ id: "active", status: "accepted", payload: { ...proposal().payload, summary: "Previous itinerary" } });
    await load({ ...trip, activeProposalId: previous.id }, [proposal(), previous]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    let finish!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(json({ error: "Proposal conflict" }, 409))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).toBe("/api/trips/trip-1");
    expect(fetchMock.mock.calls[3][1]?.method).toBe("GET");
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "Active itinerary" })).getByText("Previous itinerary")).toBeVisible();
    const latest = { ...trip, revision: 2, notes: "Changed elsewhere", activeProposalId: change === "accept" ? "proposal-1" : previous.id };
    finish(json({ trip: latest, proposals: [proposal({ status: change === "accept" ? "accepted" : "pending" }), previous] }));
    await waitFor(() => expect(screen.getByLabelText("Group notes")).toHaveValue("Changed elsewhere"));
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
    if (change === "accept") expect(within(screen.getByRole("region", { name: "Active itinerary" })).getByText("A morning in George Town")).toBeVisible();
    else expect(screen.getByText("Outdated")).toBeVisible();
  });

  it("locks uncertain decisions until an explicit reload verifies whether they committed", async () => {
    const user = userEvent.setup();
    const previous = proposal({ id: "active", status: "accepted", payload: { ...proposal().payload, summary: "Previous itinerary" } });
    await load({ ...trip, activeProposalId: previous.id }, [proposal(), previous]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The decision may have been saved. Reload trip before making another decision.");
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockRejectedValueOnce(new TypeError("Still offline"));
    await user.click(screen.getByRole("button", { name: "Reload trip" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload trip" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "Active itinerary" })).getByText("Previous itinerary")).toBeVisible();
    fetchMock.mockResolvedValueOnce(json({ trip: { ...trip, activeProposalId: "proposal-1" }, proposals: [proposal({ status: "accepted" }), previous] }));
    await user.click(screen.getByRole("button", { name: "Reload trip" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Active itinerary" })).getByText("A morning in George Town")).toBeVisible());
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload trip" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("offers reconciliation retry after a conflict refresh fails, without leaking stale state into a newer selection", async () => {
    const user = userEvent.setup();
    const second = { ...trip, id: "second", destinationName: "Ipoh" };
    fetchMock.mockResolvedValueOnce(json({ trips: [trip, second] })).mockResolvedValueOnce(json({ trip, proposals: [proposal()] }));
    render(<TripSetupDashboard email="owner@example.com" />);
    await screen.findByDisplayValue("Penang");
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    let finish!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(json({ error: "Conflict" }, 409))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.getByLabelText("Recent trips")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Recent trips"), { target: { value: "second" } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    finish(json({ error: "Unavailable" }, 503));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload trip" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeDisabled();
    fetchMock.mockResolvedValueOnce(json({ trip: second, proposals: [] }));
    await user.selectOptions(screen.getByLabelText("Recent trips"), "second");
    await screen.findByDisplayValue("Ipoh");
    expect(screen.queryByText("Market visit")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload trip" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?trip=second");
  });

  it("reenables decisions only after reload verifies that an uncertain decision did not commit", async () => {
    const user = userEvent.setup();
    await load(trip, [proposal()]);
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    fetchMock.mockRejectedValueOnce(new TypeError("Network disconnected"));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("button", { name: "Reload trip" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    fetchMock.mockResolvedValueOnce(json({ trip, proposals: [proposal()] }));
    await user.click(screen.getByRole("button", { name: "Reload trip" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeEnabled();
  });

  it("ignores a late conflict refresh after a newer workspace selection mounts", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ trips: [trip] })).mockResolvedValueOnce(json({ trip, proposals: [proposal()] }));
    const first = render(<TripSetupDashboard email="owner@example.com" />);
    await screen.findByDisplayValue("Penang");
    await user.click(screen.getByRole("tab", { name: "Plan" }));
    let finish!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(json({ error: "Conflict" }, 409))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Confirm itinerary" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const signal = fetchMock.mock.calls[3][1]?.signal;
    first.unmount();
    expect(signal?.aborted).toBe(true);
    const second = { ...trip, id: "second", destinationName: "Ipoh" };
    window.history.replaceState(null, "", "/?trip=second");
    fetchMock.mockResolvedValueOnce(json({ trips: [second] })).mockResolvedValueOnce(json({ trip: second, proposals: [] }));
    render(<TripSetupDashboard email="owner@example.com" />);
    await screen.findByDisplayValue("Ipoh");
    await act(async () => { finish(json({ trip: { ...trip, activeProposalId: "proposal-1" }, proposals: [proposal({ status: "accepted" })] })); });
    expect(screen.getByLabelText("Destination")).toHaveValue("Ipoh");
    expect(screen.queryByText("Market visit")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?trip=second");
  });
});
