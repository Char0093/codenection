// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PreferenceSurvey } from "@/components/preference-survey";
import { DEMO_INTERESTS, DEMO_PREFERENCES } from "@/lib/prototype/fixtures";

afterEach(cleanup);

const labelFor = (key: string) => DEMO_INTERESTS.find((i) => i.key === key)!.label;

function rankedLabels(): string[] {
  return screen.getAllByRole("listitem")
    .map((li) => li.querySelector(".pref-rank-label")?.textContent ?? "")
    .filter(Boolean);
}

describe("PreferenceSurvey", () => {
  it("renders the seeded interest ranking in order", () => {
    render(<PreferenceSurvey />);
    expect(rankedLabels()).toEqual(DEMO_PREFERENCES.interestOrder.map(labelFor));
  });

  it("moves an interest up the ranking", async () => {
    const user = userEvent.setup();
    render(<PreferenceSurvey />);
    const second = DEMO_PREFERENCES.interestOrder[1];
    await user.click(screen.getByRole("button", { name: new RegExp(`move ${labelFor(second)} up`, "i") }));
    expect(rankedLabels()[0]).toBe(labelFor(second));
  });

  it("explains that saving is a soft change and confirms ephemerally", async () => {
    const user = userEvent.setup();
    render(<PreferenceSurvey />);
    expect(screen.getByText(/soft change/i)).toBeInTheDocument();
    expect(screen.getByText(/current itinerary is not rewritten/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save preferences/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/resets on refresh/i);
  });
});
