// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionCard } from "@/features/prototype/decision-card";
import type { Decision } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

const SOFT_SIGNAL: Decision = {
  id: "sig-1", source: "signal", kind: "soft", title: "live jazz",
  detail: "A soft discovery signal.", forMemberName: null, expiresInDays: 3,
  createdAt: "2026-01-01T00:00:00.000Z", response: null,
};

const HARD_SIGNAL: Decision = {
  id: "sig-2", source: "signal", kind: "hard-candidate", title: "no shellfish",
  detail: "A possible hard safety constraint.", forMemberName: "Arun", expiresInDays: null,
  createdAt: "2026-01-01T00:00:00.000Z", response: null,
};

const TIMELINE_CHANGE: Decision = {
  id: "chg-1", source: "timeline", title: "Street of Harmony walk moved to 10:00–12:00 on 2026-10-03",
  detail: "A change made on the Timeline.", forMemberName: null, expiresInDays: null,
  createdAt: "2026-01-01T00:00:00.000Z", response: null,
};

describe("DecisionCard", () => {
  it("labels a soft signal as a discovery signal", () => {
    render(<DecisionCard decision={SOFT_SIGNAL} onRespond={vi.fn()} />);
    expect(screen.getByText("Discovery signal")).toBeInTheDocument();
  });

  it("labels a hard-candidate signal as a possible safety constraint, addressed to its member", () => {
    render(<DecisionCard decision={HARD_SIGNAL} onRespond={vi.fn()} />);
    expect(screen.getByText("Possible safety constraint")).toBeInTheDocument();
    expect(screen.getByText(/for Arun/)).toBeInTheDocument();
  });

  it("labels a timeline-sourced decision without signal-only chrome", () => {
    render(<DecisionCard decision={TIMELINE_CHANGE} onRespond={vi.fn()} />);
    expect(screen.getByText("Timeline change")).toBeInTheDocument();
    expect(screen.queryByText(/for /)).not.toBeInTheDocument();
  });

  it("reveals a star picker after Agree, and reports the pick", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<DecisionCard decision={SOFT_SIGNAL} onRespond={onRespond} />);

    await user.click(screen.getByRole("button", { name: "Agree" }));
    expect(screen.queryByRole("button", { name: "Agree" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rate 4 stars" }));

    expect(onRespond).toHaveBeenCalledWith("sig-1", { agree: true, stars: 4 });
  });

  it("reveals a star picker after Disagree, and reports the pick", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<DecisionCard decision={SOFT_SIGNAL} onRespond={onRespond} />);

    await user.click(screen.getByRole("button", { name: "Disagree" }));
    await user.click(screen.getByRole("button", { name: "Rate 1 star" }));

    expect(onRespond).toHaveBeenCalledWith("sig-1", { agree: false, stars: 1 });
  });

  it("shows the resolved summary once a response exists, with no actions left", () => {
    const resolved: Decision = { ...SOFT_SIGNAL, response: { agree: true, stars: 4 } };
    render(<DecisionCard decision={resolved} onRespond={vi.fn()} />);
    expect(screen.getByText(/you agreed/i)).toBeInTheDocument();
    expect(screen.getByLabelText("4 out of 5 stars")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rate/i })).not.toBeInTheDocument();
  });
});
