// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

const pathname = vi.fn(() => "/trips/t1/chat");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
afterEach(() => { cleanup(); pathname.mockReturnValue("/trips/t1/chat"); });

describe("AppShell", () => {
  it("always offers a route to the group list, Settings, and Log out", () => {
    render(<AppShell><div>body</div></AppShell>);
    expect(screen.getByRole("link", { name: /all trip groups/i })).toHaveAttribute("href", "/chats");
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: /log out/i }).closest("form")).toHaveAttribute("action", "/auth/signout");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("shows no trip section when no trip is open", () => {
    render(<AppShell><div /></AppShell>);
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
  });

  it("links Chat / Plan / Timeline / prefs for the open trip, marking the active item", () => {
    render(<AppShell trip={{ id: "t1", name: "Melaka crew", ready: true }}><div /></AppShell>);
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/trips/t1/chat");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/trips/t1/plan");
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/trips/t1/timeline");
    expect(screen.getByRole("link", { name: /your prefs/i })).toHaveAttribute("href", "/trips/t1/entry");
    expect(screen.getAllByText("Melaka crew").length).toBeGreaterThan(0);
  });

  it("locks Plan and Timeline until the trip is ready", () => {
    render(<AppShell trip={{ id: "t1", name: "Someday", ready: false }}><div /></AppShell>);
    expect(screen.queryByRole("link", { name: "Plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Timeline" })).not.toBeInTheDocument();
    expect(screen.getByText("Plan")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Timeline")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /your prefs/i })).toBeInTheDocument();
  });

  it("marks the timeline tab active on the timeline route", () => {
    pathname.mockReturnValue("/trips/t1/timeline");
    render(<AppShell trip={{ id: "t1", name: "Melaka crew", ready: true }}><div /></AppShell>);
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current");
  });

  it("shows the signed-in email when given one", () => {
    render(<AppShell accountEmail="ada@example.com"><div /></AppShell>);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("opens the mobile drawer from the menu button and closes it on backdrop click or Escape", async () => {
    const user = userEvent.setup();
    render(<AppShell><div /></AppShell>);
    const sidebar = () => screen.getByRole("link", { name: /settings/i }).closest("aside")!;
    expect(sidebar()).toHaveAttribute("data-open", "false");
    expect(screen.queryByRole("button", { name: /dismiss menu/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(sidebar()).toHaveAttribute("data-open", "true");

    await user.click(screen.getByRole("button", { name: /dismiss menu/i }));
    expect(sidebar()).toHaveAttribute("data-open", "false");

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(sidebar()).toHaveAttribute("data-open", "true");
    await user.keyboard("{Escape}");
    expect(sidebar()).toHaveAttribute("data-open", "false");
  });
});
