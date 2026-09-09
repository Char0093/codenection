// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoTimeline } from "@/features/prototype/demo-timeline";
import { DEMO_WEATHER } from "@/lib/prototype/demo-features";

afterEach(cleanup);

// Seeded day 1: "Street of Harmony walk" 09:30–11:30, "Peranakan Mansion (guided)" is locked
// (it lives on day 2, so day-1 assertions use the walk).
const walk = () => screen.getByRole("button", { name: /^Street of Harmony walk,/ });

describe("DemoTimeline drag/resize", () => {
  it("renders a seeded block with its time range", () => {
    render(<DemoTimeline />);
    expect(walk()).toHaveAccessibleName(/09:30 to 11:30/);
  });

  it("moves a block later with ArrowDown (15-minute step)", async () => {
    const user = userEvent.setup();
    render(<DemoTimeline />);
    walk().focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(walk()).toHaveAccessibleName(/10:00 to 12:00/);
  });

  it("changes duration with Shift+Arrow without moving the start", async () => {
    const user = userEvent.setup();
    render(<DemoTimeline />);
    walk().focus();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(walk()).toHaveAccessibleName(/09:30 to 11:45/);
    await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{/Shift}");
    expect(walk()).toHaveAccessibleName(/09:30 to 11:15/);
  });

  it("does not let a block move above the start of the day window", async () => {
    const user = userEvent.setup();
    render(<DemoTimeline />);
    walk().focus();
    // window opens at 06:00; the walk starts at 09:30, so 14+ up-steps would run past it
    await user.keyboard("{ArrowUp}".repeat(20));
    expect(walk()).toHaveAccessibleName(/06:00 to 08:00/);
  });

  it("simulates rain, swaps the at-risk block for the indoor plan, and undoes it", async () => {
    const user = userEvent.setup();
    render(<DemoTimeline />);

    await user.click(screen.getByRole("button", { name: /simulate rain/i }));
    // jumps to the affected day and flags the outdoor block
    expect(screen.getByRole("alert")).toHaveTextContent(DEMO_WEATHER.headline);
    const atRisk = document.querySelector('.cal-block[data-atrisk="true"]');
    expect(atRisk).toBeInTheDocument();
    expect(atRisk).toHaveTextContent(DEMO_WEATHER.affectedTitle);

    await user.click(screen.getByRole("button", { name: /use the indoor plan/i }));
    expect(document.querySelector(".wx-applied")).toHaveTextContent(DEMO_WEATHER.replacement.title);
    expect(document.querySelector('.cal-block[data-atrisk="true"]')).not.toBeInTheDocument();
    expect(screen.getAllByText(DEMO_WEATHER.replacement.title).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.getByRole("button", { name: /simulate rain/i })).toBeInTheDocument();
  });

  it("keeps a locked block non-interactive", async () => {
    const user = userEvent.setup();
    render(<DemoTimeline />);
    // switch to day 2, where the guided Peranakan Mansion block is locked
    await user.click(screen.getByRole("tab", { name: /2026-10-04/ }));
    expect(screen.getByText(/Peranakan Mansion \(guided\)/)).toBeInTheDocument();
    // locked blocks render without the button role / focusability that drag needs
    expect(screen.queryByRole("button", { name: /^Peranakan Mansion/ })).not.toBeInTheDocument();
  });
});
