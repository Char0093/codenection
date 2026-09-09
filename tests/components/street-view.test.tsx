// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreetView, povHeading } from "@/features/prototype/map/street-view";
import { bearing } from "@/features/prototype/map/geo";
import { DEMO_MAP_STOPS, DEMO_TRIP_DATES } from "@/lib/prototype/fixtures";

afterEach(cleanup);

const stops = DEMO_MAP_STOPS[DEMO_TRIP_DATES[0]];
const at = (i: number) => ({ lat: stops[i].lat, lng: stops[i].lng });

describe("povHeading", () => {
  it("faces the next stop", () => {
    expect(povHeading(stops, 0)).toBeCloseTo(bearing(at(0), at(1)), 6);
  });

  it("keeps the last leg's heading at the final stop", () => {
    const last = stops.length - 1;
    expect(povHeading(stops, last)).toBeCloseTo(bearing(at(last - 1), at(last)), 6);
  });
});

describe("StreetView overlay", () => {
  it("names the stop and offers a chip per stop on the day", () => {
    render(<StreetView stops={stops} initialIndex={0} onClose={() => {}} />);
    expect(screen.getByText(stops[0].name)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`stop ${stops[0].order} of ${stops.length}`))).toBeInTheDocument();
    const chips = within(document.querySelector(".map-streetview-stops") as HTMLElement).getAllByRole("tab");
    expect(chips).toHaveLength(stops.length);
    expect(chips[0]).toHaveAttribute("aria-selected", "true");
  });

  it("switches stop from the chip row", async () => {
    const user = userEvent.setup();
    render(<StreetView stops={stops} initialIndex={0} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: `Street view at ${stops[2].name}` }));
    expect(screen.getByText(stops[2].name)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: `Street view at ${stops[2].name}` }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("degrades to a clear message when Google Maps cannot load", async () => {
    render(<StreetView stops={stops} initialIndex={0} onClose={() => {}} />);
    // no NEXT_PUBLIC_GOOGLE_MAPS_KEY in tests -> the loader rejects
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/street view is unavailable/i));
  });

  it("closes from the button and from Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<StreetView stops={stops} initialIndex={1} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close street view/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
