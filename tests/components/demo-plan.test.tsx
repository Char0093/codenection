// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoPlan } from "@/features/prototype/demo-plan";
import { DemoTimeline } from "@/features/prototype/demo-timeline";
import { DemoDecisions } from "@/features/prototype/demo-decisions";
import { DemoTripStateProvider } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

function renderPlan() {
  return render(<DemoTripStateProvider><DemoPlan /></DemoTripStateProvider>);
}

describe("DemoPlan", () => {
  it("renders the seeded itinerary's activities with location and rationale", () => {
    renderPlan();
    expect(screen.getByText(/Three days in George Town/)).toBeInTheDocument();
    expect(screen.getByText("Street of Harmony walk")).toBeInTheDocument();
    expect(screen.getByText(/an easy orientation to the old town/i)).toBeInTheDocument();
    expect(screen.getByText("Lebuh Acheh, George Town")).toBeInTheDocument();
    // The one AI-proposed activity with no Timeline block of its own still appears.
    expect(screen.getByText(/Jazz at a Love Lane bar/)).toBeInTheDocument();
  });

  it("reflects an agreed Timeline change on the Plan tab", async () => {
    const user = userEvent.setup();
    render(
      <DemoTripStateProvider>
        <DemoTimeline />
        <DemoDecisions />
        <DemoPlan />
      </DemoTripStateProvider>,
    );

    const walk = screen.getByRole("button", { name: /^Street of Harmony walk,/ });
    walk.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.click(screen.getByRole("button", { name: /^save/i }));

    const decisionsList = document.querySelector(".decisions-list") as HTMLElement;
    const card = within(decisionsList).getAllByText(/Street of Harmony walk moved/)[0].closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Agree" }));
    await user.click(within(card).getByRole("button", { name: "Rate 5 stars" }));

    const planSection = document.querySelector(".proposal-review") as HTMLElement;
    const walkItem = within(planSection).getByText("Street of Harmony walk").closest("li")!;
    expect(within(walkItem).getByText("10:00")).toBeInTheDocument();
    expect(within(walkItem).queryByText("09:30")).not.toBeInTheDocument();
  });

  it("leaves the Plan tab unchanged when a Timeline change is disagreed", async () => {
    const user = userEvent.setup();
    render(
      <DemoTripStateProvider>
        <DemoTimeline />
        <DemoDecisions />
        <DemoPlan />
      </DemoTripStateProvider>,
    );

    const walk = screen.getByRole("button", { name: /^Street of Harmony walk,/ });
    walk.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.click(screen.getByRole("button", { name: /^save/i }));

    const decisionsList = document.querySelector(".decisions-list") as HTMLElement;
    const card = within(decisionsList).getAllByText(/Street of Harmony walk moved/)[0].closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Disagree" }));
    await user.click(within(card).getByRole("button", { name: "Rate 3 stars" }));

    const planSection = document.querySelector(".proposal-review") as HTMLElement;
    expect(within(planSection).getByText("09:30")).toBeInTheDocument();
  });
});
