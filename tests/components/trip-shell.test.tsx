// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripShell } from "@/components/trip-shell";

const pathname = vi.fn(() => "/trips/t1/chat");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
afterEach(() => { cleanup(); pathname.mockReturnValue("/trips/t1/chat"); });

describe("TripShell", () => {
  it("links Chat / Plan / Timeline / prefs and a route back to the group list, marking the active item", () => {
    render(<TripShell tripId="t1" tripName="Melaka crew" ready><div>body</div></TripShell>);
    expect(screen.getByRole("link", { name: /all trip groups/i })).toHaveAttribute("href", "/chats");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/trips/t1/chat");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/trips/t1/plan");
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/trips/t1/timeline");
    expect(screen.getByRole("link", { name: /your prefs/i })).toHaveAttribute("href", "/trips/t1/entry");
    expect(screen.getByRole("heading", { name: "Melaka crew" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("locks Plan and Timeline until the trip is ready", () => {
    render(<TripShell tripId="t1" tripName="Someday" ready={false}><div /></TripShell>);
    expect(screen.queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Timeline" })).not.toBeInTheDocument();
    expect(screen.getByText("Plan")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Timeline")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /your prefs/i })).toBeInTheDocument();
  });

  it("marks the timeline tab active on the timeline route", () => {
    pathname.mockReturnValue("/trips/t1/timeline");
    render(<TripShell tripId="t1" tripName="Melaka crew" ready><div /></TripShell>);
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current");
  });
});
