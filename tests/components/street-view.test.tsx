// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreetView, facingCue, formatRemaining, povHeading } from "@/features/prototype/map/street-view";
import {
  bearing, distanceMetres, headingAlongPath, initialHeading, relativeBearing, remainingDistance,
} from "@/features/prototype/map/geo";
import { DEMO_MAP_STOPS, DEMO_ROUTE_LEGS, DEMO_TRIP_DATES } from "@/lib/prototype/fixtures";

afterEach(cleanup);

const DAY = DEMO_TRIP_DATES[0];
const stops = DEMO_MAP_STOPS[DAY];
const legs = DEMO_ROUTE_LEGS[DAY];
const at = (i: number) => ({ lat: stops[i].lat, lng: stops[i].lng });

describe("povHeading", () => {
  it("prefers the route's real set-off bearing over the straight line to the next stop", () => {
    // Measured against the live Google route at Street of Harmony: the walkable street leaves
    // at ~295° while the crow-flies line to the next stop is ~266°. Pointing at 266° aims the
    // traveller at a building, so the routed heading must win.
    const crow = bearing(at(0), at(1));
    expect(crow).toBeCloseTo(266.5, 0);
    expect(povHeading(stops, 0, [295.2, 10, 20])).toBe(295.2);
    // ...and 266 would have been mislabelled "Straight ahead", which is the bug this prevents.
    expect(facingCue(relativeBearing(crow, 295.2)).mode).not.toBe("ahead");
  });

  it("falls back to the crow-flies bearing when there is no route", () => {
    expect(povHeading(stops, 0)).toBeCloseTo(bearing(at(0), at(1)), 6);
    expect(povHeading(stops, 0, [])).toBeCloseTo(bearing(at(0), at(1)), 6);
  });

  it("keeps the last leg's heading at the final stop", () => {
    const last = stops.length - 1;
    expect(povHeading(stops, last)).toBeCloseTo(bearing(at(last - 1), at(last)), 6);
  });
});

describe("initialHeading", () => {
  it("uses the direction ~20 m along the path, not the straight line to its end", () => {
    // A path that sets off due north for 40 m, then doglegs hard east.
    const start = { lat: 5.4, lng: 100.3 };
    const north = { lat: 5.4 + 0.00036, lng: 100.3 };            // ~40 m north
    const thenEast = { lat: 5.4 + 0.00036, lng: 100.3 + 0.0045 }; // ~500 m east
    expect(initialHeading([start, north, thenEast])).toBeCloseTo(0, 0);
    // the naive start->end bearing would have read almost due east
    expect(bearing(start, thenEast)).toBeGreaterThan(80);
  });

  it("returns null when there is no usable path", () => {
    expect(initialHeading([])).toBeNull();
    expect(initialHeading([{ lat: 5.4, lng: 100.3 }])).toBeNull();
    expect(initialHeading([{ lat: 5.4, lng: 100.3 }, { lat: 5.4, lng: 100.3 }])).toBeNull();
  });

  it("measures distance sanely", () => {
    expect(distanceMetres({ lat: 5.4, lng: 100.3 }, { lat: 5.4, lng: 100.3 })).toBe(0);
    expect(distanceMetres({ lat: 5.4, lng: 100.3 }, { lat: 5.40090, lng: 100.3 })).toBeCloseTo(100, -1);
  });
});

describe("walking along the route", () => {
  // A straight 400 m path due east, sampled every 100 m.
  const p = (i: number) => ({ lat: 5.4, lng: 100.3 + i * 0.0009 });
  const path = [p(0), p(1), p(2), p(3), p(4)];

  it("remaining distance goes down as you move along it", () => {
    const atStart = remainingDistance(path, p(0));
    const midway = remainingDistance(path, p(2));
    const nearEnd = remainingDistance(path, p(4));
    expect(atStart).toBeGreaterThan(midway);
    expect(midway).toBeGreaterThan(nearEnd);
    expect(nearEnd).toBeLessThan(5);
    expect(atStart).toBeCloseTo(400, -2);
  });

  it("heading is taken from where you now stand, not from the start", () => {
    // Dog-leg: 200 m east, then hard north.
    const legPath = [p(0), p(1), p(2), { lat: 5.4 + 0.0018, lng: 100.3 + 2 * 0.0009 }];
    // standing at the start you should still be sent east
    expect(headingAlongPath(legPath, p(0))).toBeCloseTo(90, -1);
    // once past the corner you should be sent north instead
    expect(headingAlongPath(legPath, p(2))).toBeCloseTo(0, -1);
  });

  it("formats a countdown that shortens with distance", () => {
    expect(formatRemaining(700)).toMatch(/700 m · 9 min walk/);
    expect(formatRemaining(160)).toMatch(/160 m · 2 min walk/);
    expect(formatRemaining(20)).toMatch(/20 m · 1 min walk/);
    expect(formatRemaining(1400)).toMatch(/1\.4 km/);
  });
});

describe("relativeBearing", () => {
  it("is zero when you already face the target", () => {
    expect(relativeBearing(90, 90)).toBe(0);
  });

  it("takes the short way round the compass", () => {
    expect(relativeBearing(10, 350)).toBe(20);   // not -340
    expect(relativeBearing(350, 10)).toBe(-20);  // not 340
  });

  it("stays inside (-180, 180] for any heading", () => {
    for (let h = 0; h < 360; h += 7) {
      for (const t of [0, 45, 123, 271, 359]) {
        const d = relativeBearing(t, h);
        expect(d).toBeGreaterThan(-181);
        expect(d).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe("facingCue", () => {
  it("reads ahead / right / left / behind from the offset", () => {
    expect(facingCue(0).mode).toBe("ahead");
    expect(facingCue(20).mode).toBe("ahead");
    expect(facingCue(60)).toMatchObject({ mode: "turn", text: "To your right" });
    expect(facingCue(-60)).toMatchObject({ mode: "turn", text: "To your left" });
    expect(facingCue(170).mode).toBe("behind");
    expect(facingCue(-180).mode).toBe("behind");
  });
});

describe("StreetView overlay", () => {
  it("names the stop and offers a chip per stop on the day", () => {
    render(<StreetView stops={stops} legs={legs} legHeadings={[295.2, 10, 20]} initialIndex={0} onClose={() => {}} />);
    expect(screen.getByText(stops[0].name)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`stop ${stops[0].order} of ${stops.length}`))).toBeInTheDocument();
    const chips = within(document.querySelector(".map-streetview-stops") as HTMLElement).getAllByRole("tab");
    expect(chips).toHaveLength(stops.length);
    expect(chips[0]).toHaveAttribute("aria-selected", "true");
  });

  it("switches stop from the chip row", async () => {
    const user = userEvent.setup();
    render(<StreetView stops={stops} legs={legs} legHeadings={[295.2, 10, 20]} initialIndex={0} onClose={() => {}} />);
    await user.click(screen.getByRole("tab", { name: `Street view at ${stops[2].name}` }));
    expect(screen.getByText(stops[2].name)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: `Street view at ${stops[2].name}` }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("degrades to a clear message when Google Maps cannot load", async () => {
    render(<StreetView stops={stops} legs={legs} legHeadings={[295.2, 10, 20]} initialIndex={0} onClose={() => {}} />);
    // no NEXT_PUBLIC_GOOGLE_MAPS_KEY in tests -> the loader rejects, so no panorama and no guide
    await waitFor(() => expect(document.querySelector(".map-streetview-state"))
      .toHaveTextContent(/street view is unavailable/i));
    expect(document.querySelector(".sv-guide")).not.toBeInTheDocument();
  });

  it("still runs its effects under StrictMode's double mount", async () => {
    // Regression: a cleanup-only `mountedRef` latched false on StrictMode's second mount, so
    // every guard bailed and the panorama never loaded — the screen sat on "Opening street
    // view…" forever and the direction arrow froze. If that returns, this never leaves loading.
    render(
      <React.StrictMode>
        <StreetView stops={stops} legs={legs} legHeadings={[295.2, 10, 20]} initialIndex={0} onClose={() => {}} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(document.querySelector(".map-streetview-state"))
      .toHaveTextContent(/street view is unavailable/i));
    expect(document.querySelector(".map-streetview-state")).not.toHaveTextContent(/opening street view/i);
  });

  it("closes from the button and from Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<StreetView stops={stops} legs={legs} legHeadings={[295.2, 10, 20]} initialIndex={1} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close street view/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
