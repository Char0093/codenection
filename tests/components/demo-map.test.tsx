// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoMap } from "@/features/prototype/demo-map";
import { DEMO_MAP_STOPS, DEMO_ROUTE_LEGS, DEMO_TRIP_DATES } from "@/lib/prototype/fixtures";

afterEach(cleanup);

const DAY1 = DEMO_TRIP_DATES[0];
const LAST = DEMO_TRIP_DATES[DEMO_TRIP_DATES.length - 1];
const sheet = () => document.querySelector(".map-sheet") as HTMLElement;

describe("DemoMap route screen (no Maps key → fallback chrome)", () => {
  it("shows the route card, day chips and the day's stops in the sheet", () => {
    render(<DemoMap />);
    const stops = DEMO_MAP_STOPS[DAY1];
    const card = document.querySelector(".map-routecard") as HTMLElement;
    expect(within(card).getByText(stops[0].name)).toBeInTheDocument();
    expect(within(card).getByText(stops[stops.length - 1].name)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Day 1" })).toHaveAttribute("aria-selected", "true");
    for (const stop of stops) {
      expect(within(sheet()).getByText(stop.name)).toBeInTheDocument();
    }
  });

  it("summarises the day's walking route from the fixture legs", () => {
    render(<DemoMap />);
    const legs = DEMO_ROUTE_LEGS[DAY1];
    const walkMin = legs.reduce((s, l) => s + l.minutes, 0);
    const km = legs.reduce((s, l) => s + l.distanceKm, 0);
    expect(document.querySelector(".map-summary-time")).toHaveTextContent(`${walkMin} min`);
    expect(document.querySelector(".map-summary-time")).toHaveTextContent(`${km.toFixed(1)} km`);
  });

  it("re-times the summary when the travel mode changes", async () => {
    const user = userEvent.setup();
    render(<DemoMap />);
    const walkMin = DEMO_ROUTE_LEGS[DAY1].reduce((s, l) => s + l.minutes, 0);
    const driveMin = Math.max(1, Math.round(walkMin / 3.6));
    await user.click(screen.getByRole("tab", { name: "Drive" }));
    expect(document.querySelector(".map-summary-time")).toHaveTextContent(`${driveMin} min`);
    expect(screen.getByRole("tab", { name: "Drive" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches the routed day from the day chips", async () => {
    const user = userEvent.setup();
    render(<DemoMap />);
    await user.click(screen.getByRole("tab", { name: `Day ${DEMO_TRIP_DATES.length}` }));
    for (const stop of DEMO_MAP_STOPS[LAST]) {
      expect(within(sheet()).getByText(stop.name)).toBeInTheDocument();
    }
    // a day-1 stop that is not on the last day is gone
    expect(within(sheet()).queryByText(DEMO_MAP_STOPS[DAY1][0].name)).not.toBeInTheDocument();
  });

  it("cycles the bottom sheet snap point when the handle is activated", async () => {
    const user = userEvent.setup();
    render(<DemoMap />);
    expect(sheet()).toHaveAttribute("data-snap", "half");
    await user.click(screen.getByRole("button", { name: /route details/i }));
    expect(sheet()).toHaveAttribute("data-snap", "full");
    await user.click(screen.getByRole("button", { name: /route details/i }));
    expect(sheet()).toHaveAttribute("data-snap", "peek");
  });
});
