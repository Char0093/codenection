// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { JigsawView } from "@/features/prototype/jigsaw-view";
import { evaluateTeam, shouldSplitCut } from "@/lib/domain/jigsaw";
import {
  ARUN, DEMO_JIGSAW_CANDIDATES, DEMO_JIGSAW_TOGETHER, DEMO_SPLIT, MEMBER_IDS,
} from "@/lib/prototype/demo-features";

afterEach(cleanup);

const scheduled = DEMO_JIGSAW_CANDIDATES.filter((b) => DEMO_JIGSAW_TOGETHER.includes(b.id));
const outcome = evaluateTeam(scheduled, DEMO_JIGSAW_CANDIDATES, [...MEMBER_IDS]);

describe("JigsawView", () => {
  it("the fixture genuinely makes the real engine call for a split", () => {
    // Guards the screen's premise: if someone retunes the scores, this fails rather than the
    // UI quietly claiming a split the engine no longer recommends.
    expect(outcome.fair).toBe(false);
    expect(outcome.worstMemberId).toBe(ARUN);
    expect(shouldSplitCut(outcome)).toBe(true);
  });

  it("shows each member's share of their own best afternoon, flagging the one below fair share", () => {
    render(<JigsawView />);
    const arun = outcome.members.find((m) => m.memberId === ARUN)!;
    expect(screen.getAllByText(`${Math.round(arun.ratio * 100)}%`).length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent(/under the 70% fair share/i);
  });

  it("accepting the split lifts the worst-served member and names the rendezvous", async () => {
    const user = userEvent.setup();
    render(<JigsawView />);
    expect(screen.getAllByText(new RegExp(DEMO_SPLIT.rendezvous.name)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /accept split/i }));
    expect(screen.getByText(/split accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody's afternoon got worse/i)).toBeInTheDocument();
    // Arun's regret was 8; the split closes it, so a positive delta is shown
    expect(document.querySelectorAll(".jig-delta").length).toBeGreaterThan(0);
  });

  it("keeping the group together says who stays short", async () => {
    const user = userEvent.setup();
    render(<JigsawView />);
    await user.click(screen.getByRole("button", { name: /keep everyone together/i }));
    expect(screen.getByText(/stays below their fair share/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reconsider/i }));
    expect(screen.getByRole("button", { name: /accept split/i })).toBeInTheDocument();
  });
});
