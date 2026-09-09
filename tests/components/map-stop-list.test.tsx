// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StopList } from "@/features/prototype/map/stop-list";
import type { ModeRoute } from "@/features/prototype/map/types";
import { DEMO_MAP_STOPS, DEMO_ROUTE_LEGS, DEMO_TRIP_DATES } from "@/lib/prototype/fixtures";

afterEach(cleanup);

const DAY1 = DEMO_TRIP_DATES[0];
const stops = DEMO_MAP_STOPS[DAY1];
const legs = DEMO_ROUTE_LEGS[DAY1];

const route: ModeRoute = {
  status: "ok",
  steps: [
    { instruction: "Head northwest on Pesara Claimant", distanceText: "0.2 km" },
    { instruction: "Turn left onto Jalan Pintal Tali", distanceText: "0.1 km", maneuver: "turn-left" },
    { instruction: "Turn right onto Beach St", distanceText: "68 m", maneuver: "turn-right" },
    { instruction: "Destination will be on the left", distanceText: "0.1 km" },
  ],
};

describe("StopList turn-by-turn", () => {
  it("renders the stops with their fixture legs", () => {
    render(<StopList stops={stops} legs={legs} activeRoute={{ status: "ok" }} />);
    for (const stop of stops) expect(screen.getByText(stop.name)).toBeInTheDocument();
    const l = legs[0];
    expect(screen.getByText(new RegExp(`${l.minutes} min ${l.mode}`, "i"))).toBeInTheDocument();
  });

  it("has no turn-by-turn section when the route has no steps", () => {
    render(<StopList stops={stops} legs={legs} activeRoute={{ status: "ok" }} />);
    expect(screen.queryByRole("button", { name: /turn-by-turn/i })).not.toBeInTheDocument();
  });

  it("offers a street-view button per stop only when a live map can serve one", async () => {
    const user = userEvent.setup();
    const onLookAround = vi.fn();
    const { rerender } = render(<StopList stops={stops} legs={legs} activeRoute={{ status: "ok" }} />);
    expect(screen.queryByRole("button", { name: /street view at/i })).not.toBeInTheDocument();

    rerender(<StopList stops={stops} legs={legs} activeRoute={{ status: "ok" }} onLookAround={onLookAround} />);
    const buttons = screen.getAllByRole("button", { name: /street view at/i });
    expect(buttons).toHaveLength(stops.length);
    await user.click(screen.getByRole("button", { name: `Street view at ${stops[2].name}` }));
    expect(onLookAround).toHaveBeenCalledWith(2);
  });

  it("expands the steps with a directional icon per step", async () => {
    const user = userEvent.setup();
    render(<StopList stops={stops} legs={legs} activeRoute={route} />);
    await user.click(screen.getByRole("button", { name: /show turn-by-turn \(4 steps\)/i }));
    expect(screen.getByText("Turn left onto Jalan Pintal Tali")).toBeInTheDocument();
    expect(screen.getByText("Destination will be on the left")).toBeInTheDocument();
    // one .maneuver-icon per step, and the last one is the destination variant
    const icons = document.querySelectorAll(".maneuver-icon");
    expect(icons).toHaveLength(4);
    expect(icons[3]).toHaveClass("maneuver-icon-dest");
  });
});
