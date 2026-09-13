// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoTripStateProvider, useDemoTripState } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

function Probe() {
  const { decisions, addTimelineDecision, respondToDecision, planBlocks } = useDemoTripState();
  return (
    <div>
      <p data-testid="count">{decisions.length}</p>
      <p data-testid="plan-blocks">{planBlocks.map((b) => `${b.id}:${b.title}`).join(",")}</p>
      <ul>
        {decisions.map((d) => (
          <li key={d.id}>
            {d.source}:{d.title}:{d.response ? `${d.response.agree}-${d.response.stars}` : "pending"}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => addTimelineDecision({ text: "Test change" })}>add</button>
      <button
        type="button"
        onClick={() => addTimelineDecision({
          text: "Moved block b1",
          blockPatch: {
            blockId: "b1",
            result: { id: "b1", title: "Moved walk", category: "culture", date: "2026-10-03", startMinute: 600, durationMinutes: 90 },
          },
        })}
      >
        add-with-patch
      </button>
      <button
        type="button"
        onClick={() => addTimelineDecision({ text: "Removed block b2", blockPatch: { blockId: "b2", result: null } })}
      >
        add-removal-patch
      </button>
      <button type="button" onClick={() => respondToDecision(decisions[decisions.length - 1]?.id, { agree: true, stars: 5 })}>
        agree-last
      </button>
      <button type="button" onClick={() => respondToDecision(decisions[decisions.length - 1]?.id, { agree: false, stars: 2 })}>
        disagree-last
      </button>
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

describe("useDemoTripState planBlocks", () => {
  it("seeds planBlocks from the demo itinerary fixture", () => {
    renderProbe();
    expect(screen.getByTestId("plan-blocks")).toHaveTextContent("b1:Street of Harmony walk");
  });

  it("applies an agreed timeline decision's block patch to planBlocks", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "add-with-patch" }));
    await user.click(screen.getByRole("button", { name: "agree-last" }));
    expect(screen.getByTestId("plan-blocks")).toHaveTextContent("b1:Moved walk");
  });

  it("leaves planBlocks unchanged when a timeline decision is disagreed", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "add-with-patch" }));
    await user.click(screen.getByRole("button", { name: "disagree-last" }));
    expect(screen.getByTestId("plan-blocks")).toHaveTextContent("b1:Street of Harmony walk");
  });

  it("removes a block from planBlocks when the agreed patch's result is null", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "add-removal-patch" }));
    await user.click(screen.getByRole("button", { name: "agree-last" }));
    expect(screen.getByTestId("plan-blocks")).not.toHaveTextContent("Hawker lunch");
  });
});
