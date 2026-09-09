// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DailyRhythm } from "@/features/prototype/daily-rhythm";

afterEach(cleanup);

describe("DailyRhythm", () => {
  it("shows the group's shared window as the overlap of every member's window", () => {
    render(<DailyRhythm />);
    // Seed: You 09:00-22:00, Mei 08:30-21:00, Arun 10:00-23:30 -> overlap 10:00-21:00.
    expect(screen.getByRole("status")).toHaveTextContent("Group day: 10:00–21:00");
  });

  it("recomputes the shared window when you change your own start time", async () => {
    const user = userEvent.setup();
    render(<DailyRhythm />);
    const start = screen.getByLabelText(/start/i);
    await user.clear(start);
    await user.type(start, "11:30");
    expect(screen.getByRole("status")).toHaveTextContent("Group day: 11:30–21:00");
  });

  it("reports no shared window when your window no longer overlaps the others", async () => {
    const user = userEvent.setup();
    render(<DailyRhythm />);
    const end = screen.getByLabelText(/wind down/i);
    await user.clear(end);
    await user.type(end, "09:00");
    expect(screen.getByRole("status")).toHaveTextContent(/no shared window/i);
  });
});
