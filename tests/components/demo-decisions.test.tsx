// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoDecisions } from "@/features/prototype/demo-decisions";
import { DemoTripStateProvider } from "@/features/prototype/demo-trip-state";
import { DemoTimeline } from "@/features/prototype/demo-timeline";

afterEach(cleanup);

function renderDecisions() {
  return render(<DemoTripStateProvider><DemoDecisions /></DemoTripStateProvider>);
}

describe("DemoDecisions", () => {
  it("lists the seeded discovery signal and safety constraint", () => {
    renderDecisions();
    expect(screen.getByText(/live jazz/i)).toBeInTheDocument();
    expect(screen.getByText(/possible safety constraint/i)).toBeInTheDocument();
    expect(screen.getByText(/for Arun/i)).toBeInTheDocument();
  });

  it("resolves a decision after Agree then a star pick", async () => {
    const user = userEvent.setup();
    renderDecisions();
    const card = screen.getByText(/live jazz/i).closest("li")!;

    await user.click(within(card).getByRole("button", { name: "Agree" }));
    await user.click(within(card).getByRole("button", { name: "Rate 4 stars" }));

    expect(within(card).getByText(/you agreed/i)).toBeInTheDocument();
    expect(within(card).getByLabelText("4 out of 5 stars")).toBeInTheDocument();
  });

  it("adds a decision card when a Timeline change is saved", async () => {
    const user = userEvent.setup();
    render(
      <DemoTripStateProvider>
        <DemoTimeline />
        <DemoDecisions />
      </DemoTripStateProvider>,
    );

    const walk = screen.getByRole("button", { name: /^Street of Harmony walk,/ });
    walk.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.click(screen.getByRole("button", { name: /^save/i }));

    // Two ArrowDown presses queue two separate "move" pending changes (one per key press --
    // see queueChange in demo-timeline.tsx), so Save creates two Timeline-sourced decisions here,
    // both labeled "Timeline change"; hence getAllByText rather than the single-match getByText.
    expect(screen.getAllByText(/timeline change/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Street of Harmony walk moved to 10:00–12:00/)).toBeInTheDocument();
  });
});
