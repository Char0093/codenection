// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavMode } from "@/features/prototype/map/nav-mode";
import type { RouteStep } from "@/features/prototype/map/types";

afterEach(cleanup);

const steps: RouteStep[] = [
  { instruction: "Head northwest on Pesara Claimant", distanceText: "0.2 km", lat: 5.4165, lng: 100.3356 },
  { instruction: "Turn left onto Jalan Pintal Tali", distanceText: "0.1 km", maneuver: "turn-left", lat: 5.4162, lng: 100.3348 },
  { instruction: "Turn right onto Beach St", distanceText: "68 m", maneuver: "turn-right", lat: 5.4155, lng: 100.3401 },
];

function setup(index = 0) {
  const onIndex = vi.fn();
  const onExit = vi.fn();
  render(<NavMode steps={steps} index={index} destination="Armenian Street art"
    onIndex={onIndex} onExit={onExit} />);
  return { onIndex, onExit };
}

describe("NavMode", () => {
  it("shows the current manoeuvre, its distance and the step counter", () => {
    setup(0);
    expect(screen.getByText(steps[0].instruction)).toBeInTheDocument();
    expect(screen.getByText("0.2 km")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3");
  });

  it("cannot go back from the first step", () => {
    setup(0);
    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
  });

  it("advances and rewinds through the steps", async () => {
    const user = userEvent.setup();
    const { onIndex } = setup(1);
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(onIndex).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(onIndex).toHaveBeenCalledWith(0);
  });

  it("arrives on the last step and finishes instead of advancing", async () => {
    const user = userEvent.setup();
    const { onExit } = setup(steps.length - 1);
    expect(screen.getByRole("status")).toHaveTextContent("Arrived · Armenian Street art");
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /finish/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("drives from the keyboard: arrows step, Escape exits", async () => {
    const user = userEvent.setup();
    const { onIndex, onExit } = setup(1);
    await user.keyboard("{ArrowRight}");
    expect(onIndex).toHaveBeenCalledWith(2);
    await user.keyboard("{ArrowLeft}");
    expect(onIndex).toHaveBeenCalledWith(0);
    await user.keyboard("{Escape}");
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
