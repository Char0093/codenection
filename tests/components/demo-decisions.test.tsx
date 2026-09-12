// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoDecisions } from "@/features/prototype/demo-decisions";
import { DemoTripStateProvider } from "@/features/prototype/demo-trip-state";

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
});
