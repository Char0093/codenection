// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHomeView } from "@/components/chat-home-view";
import type { ChatHomeTrip } from "@/lib/domain/chat-home";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

const trip = (over: Partial<ChatHomeTrip> = {}): ChatHomeTrip => ({
  id: "12345678-1234-4123-8123-123456789012",
  name: "Melaka crew",
  status: "ready",
  destinationName: "Melaka",
  startDate: "2026-12-12",
  endDate: "2026-12-14",
  tripMode: "balanced",
  plannedDurationDays: null,
  proposedBudgetTier: "standard",
  memberCount: 2,
  latestMessage: { preview: "see you at 9", at: "2026-12-01T08:00:00.000Z" },
  memberAvatars: [{ id: "12345678-1234-4123-8123-1234567890ab", displayName: "Ada", color: "#182544" }],
  unread: null,
  ...over,
});

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); push.mockReset(); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ChatHomeView", () => {
  it("shows an honest empty state with a create call to action", async () => {
    const user = userEvent.setup();
    render(<ChatHomeView trips={[]} />);
    expect(screen.getByText(/no trip groups yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create your first trip group/i }));
    expect(screen.getByLabelText(/group name/i)).toBeInTheDocument();
  });

  it("lists a group as a link to its chat with the latest-message preview", () => {
    render(<ChatHomeView trips={[trip()]} />);
    const link = screen.getByRole("link", { name: /Melaka crew/ });
    expect(link).toHaveAttribute("href", "/trips/12345678-1234-4123-8123-123456789012/chat");
    expect(within(link).getByText("see you at 9")).toBeInTheDocument();
  });

  it("marks a draft group as planning-locked", () => {
    render(<ChatHomeView trips={[trip({ status: "draft", startDate: null, endDate: null, plannedDurationDays: 5 })]} />);
    expect(screen.getByText(/planning locked until dates are set/i)).toBeInTheDocument();
  });

  it("blocks submit until name, destination, mode and a timeframe are set, then posts a date-pair frame and navigates", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ tripId: "99999999-1234-4123-8123-123456789012" }, 201));
    render(<ChatHomeView trips={[]} />);
    await user.click(screen.getByRole("button", { name: /create your first trip group/i }));

    const submit = screen.getByRole("button", { name: /create trip group/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/group name/i), "Melaka crew");
    await user.type(screen.getByLabelText(/destination/i), "Melaka");
    await user.selectOptions(screen.getByLabelText(/trip style/i), "balanced");
    await user.type(screen.getByLabelText(/start date/i), "2026-12-12");
    await user.type(screen.getByLabelText(/end date/i), "2026-12-14");
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips/99999999-1234-4123-8123-123456789012/chat"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chats");
    expect(lastBody()).toMatchObject({
      name: "Melaka crew", destinationName: "Melaka", tripMode: "balanced",
      startDate: "2026-12-12", endDate: "2026-12-14", splitAllowed: false,
    });
  });

  it("posts a duration-only frame when the rough-length option is chosen", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ tripId: "99999999-1234-4123-8123-123456789012" }, 201));
    render(<ChatHomeView trips={[]} />);
    await user.click(screen.getByRole("button", { name: /create your first trip group/i }));
    await user.type(screen.getByLabelText(/group name/i), "Someday");
    await user.type(screen.getByLabelText(/destination/i), "Ipoh");
    await user.selectOptions(screen.getByLabelText(/trip style/i), "relaxed");
    await user.click(screen.getByRole("radio", { name: /rough length/i }));
    await user.type(screen.getByLabelText(/how many days/i), "5");
    await user.click(screen.getByRole("button", { name: /create trip group/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ destinationName: "Ipoh", tripMode: "relaxed", plannedDurationDays: 5 });
    expect(lastBody().startDate ?? null).toBeNull();
  });

  it("surfaces a server error and does not navigate", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ error: "That trip frame is not valid.", code: "INVALID_TRIP_FRAME" }, 422));
    render(<ChatHomeView trips={[]} />);
    await user.click(screen.getByRole("button", { name: /create your first trip group/i }));
    await user.type(screen.getByLabelText(/group name/i), "x");
    await user.type(screen.getByLabelText(/destination/i), "Ipoh");
    await user.selectOptions(screen.getByLabelText(/trip style/i), "mixed");
    await user.click(screen.getByRole("radio", { name: /rough length/i }));
    await user.type(screen.getByLabelText(/how many days/i), "3");
    await user.click(screen.getByRole("button", { name: /create trip group/i }));

    expect(await screen.findByText(/trip frame is not valid/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
