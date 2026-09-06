// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TravelDnaNudge } from "@/components/travel-dna-nudge";

beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });
afterEach(() => cleanup());

describe("TravelDnaNudge", () => {
  it("links to the trip's onboarding route", () => {
    render(<TravelDnaNudge tripId="trip-9" />);
    expect(screen.getByRole("link", { name: /Start/ })).toHaveAttribute("href", "/trips/trip-9/onboarding");
  });

  it("dismisses for the browser session, and a remount for the same trip stays dismissed", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TravelDnaNudge tripId="trip-9" />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("travel-dna-nudge-dismissed:trip-9")).toBe("1");
    unmount();
    render(<TravelDnaNudge tripId="trip-9" />);
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
  });

  it("still renders for a different tripId when the prop changes on the same instance", () => {
    const { rerender } = render(<TravelDnaNudge tripId="trip-9" />);
    rerender(<TravelDnaNudge tripId="trip-10" />);
    expect(screen.getByRole("link", { name: /Start/ })).toHaveAttribute("href", "/trips/trip-10/onboarding");
  });

  it("resets the dismissal when the tripId prop changes without a remount", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TravelDnaNudge tripId="trip-9" />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
    rerender(<TravelDnaNudge tripId="trip-10" />);
    expect(screen.getByRole("link", { name: /Start/ })).toBeInTheDocument();
  });
});
