// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoTripStateProvider, useDemoTripState } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

function Probe() {
  const { decisions, addTimelineDecision, respondToDecision } = useDemoTripState();
  return (
    <div>
      <p data-testid="count">{decisions.length}</p>
      <ul>
        {decisions.map((d) => (
          <li key={d.id}>
            {d.source}:{d.title}:{d.response ? `${d.response.agree}-${d.response.stars}` : "pending"}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => addTimelineDecision({ text: "Test change" })}>add</button>
      <button type="button" onClick={() => respondToDecision(decisions[0]?.id, { agree: true, stars: 5 })}>
        respond-first
      </button>
    </div>
  );
}

function renderProbe() {
  return render(<DemoTripStateProvider><Probe /></DemoTripStateProvider>);
}

describe("useDemoTripState decisions", () => {
  it("seeds decisions from the demo signal fixtures", () => {
    renderProbe();
    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(screen.getByText(/signal:live jazz:pending/)).toBeInTheDocument();
    expect(screen.getByText(/signal:no shellfish:pending/)).toBeInTheDocument();
  });

  it("appends a timeline decision via addTimelineDecision", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByText(/timeline:Test change:pending/)).toBeInTheDocument();
  });

  it("records a response via respondToDecision", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "respond-first" }));
    expect(screen.getByText(/true-5/)).toBeInTheDocument();
  });
});
