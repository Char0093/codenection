// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavMode } from "@/features/prototype/map/nav-mode";
import type { RouteStep } from "@/features/prototype/map/types";
import type { NavSim } from "@/features/prototype/map/use-nav-sim";

afterEach(cleanup);

const steps: RouteStep[] = [
  { instruction: "Head northwest on Pesara Claimant", distanceText: "0.2 km", lat: 5.4165, lng: 100.3356 },
  { instruction: "Turn left onto Jalan Pintal Tali", distanceText: "0.1 km", maneuver: "turn-left", lat: 5.4162, lng: 100.3348 },
  { instruction: "Turn right onto Beach St", distanceText: "68 m", maneuver: "turn-right", lat: 5.4155, lng: 100.3401 },
];

function makeSim(overrides: Partial<NavSim> = {}): NavSim {
  return {
    position: { lat: 5.4162, lng: 100.3348 },
    heading: 45,
    stepIndex: 0,
    progress: 0,
    playing: false,
    arrived: false,
    speed: 1,
    remainingText: "0.3 km · 4 min",
    etaText: "arrives 10:04 AM",
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
    cycleSpeed: vi.fn(),
    ...overrides,
  };
}

function setup(simOverrides: Partial<NavSim> = {}) {
  const onExit = vi.fn();
  const sim = makeSim(simOverrides);
  render(<NavMode steps={steps} sim={sim} destination="Armenian Street art" onExit={onExit} />);
  return { onExit, sim };
}

describe("NavMode", () => {
  it("shows the current manoeuvre and its distance for the sim's step index", () => {
    setup({ stepIndex: 1 });
    expect(screen.getByText(steps[1].instruction)).toBeInTheDocument();
    expect(screen.getByText("0.1 km")).toBeInTheDocument();
  });

  it("reflects progress on the scrubber and remaining distance/ETA in the bar", () => {
    setup({ progress: 0.4, remainingText: "0.6 km · 8 min", etaText: "arrives 10:12 AM" });
    expect(screen.getByRole("slider", { name: /navigation progress/i })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("0.6 km · 8 min")).toBeInTheDocument();
    expect(screen.getByText("arrives 10:12 AM")).toBeInTheDocument();
  });

  it("toggles play/pause from the play button and the space bar", async () => {
    const user = userEvent.setup();
    const { sim } = setup({ playing: false });
    await user.click(screen.getByRole("button", { name: /^play$/i }));
    expect(sim.toggle).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(sim.toggle).toHaveBeenCalledTimes(2);
  });

  it("seeks forward and back from the keyboard, and exits on Escape", async () => {
    const user = userEvent.setup();
    const { sim, onExit } = setup({ progress: 0.5 });
    await user.keyboard("{ArrowRight}");
    expect(sim.seek).toHaveBeenCalledWith(0.54);
    await user.keyboard("{ArrowLeft}");
    expect(sim.seek).toHaveBeenCalledWith(0.46);
    await user.keyboard("{Escape}");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("cycles playback speed from its own control", async () => {
    const user = userEvent.setup();
    const { sim } = setup({ speed: 1 });
    await user.click(screen.getByRole("button", { name: /playback speed 1x/i }));
    expect(sim.cycleSpeed).toHaveBeenCalledTimes(1);
  });

  it("shows an arrived state with a Finish button instead of play controls", async () => {
    const user = userEvent.setup();
    const { onExit } = setup({ arrived: true, progress: 1, stepIndex: steps.length - 1 });
    expect(screen.getByText("You've arrived")).toBeInTheDocument();
    expect(screen.getByText("Arrived")).toBeInTheDocument();
    expect(screen.getByText("Armenian Street art")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^play$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /finish/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
