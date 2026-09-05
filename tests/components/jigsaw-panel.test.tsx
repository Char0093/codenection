// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JigsawPanel, type JigsawMember } from "@/features/timeline/jigsaw-panel";
import { SLOT_MINUTES, type TimelineBlock } from "@/lib/domain/jigsaw";

const members: JigsawMember[] = [
  { id: "amira", displayName: "Amira", color: "#126a61" },
  { id: "ben", displayName: "Ben", color: "#315f8f" },
];

function block(overrides: Partial<TimelineBlock> & { id: string }): TimelineBlock {
  return {
    title: "Block " + overrides.id,
    category: "culture",
    durationMinutes: 60,
    startMinute: 10 * 60,
    weight: 5,
    fixedTime: false,
    satisfaction: { amira: 8, ben: 8 },
    ownerId: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("JigsawPanel", () => {
  it("renders placed blocks with their time and duration, sized by duration", () => {
    render(
      <JigsawPanel
        blocks={[block({ id: "jonker", title: "Jonker Street", startMinute: 10 * 60, durationMinutes: 90 })]}
        members={members}
        scale={2}
      />,
    );

    const jonker = screen.getByRole("button", { name: /Jonker Street, 10:00 for 90 minutes/ });
    // Height is proportional to duration on the vertical timeline: 90 minutes at scale 2.
    expect(jonker).toHaveStyle({ height: "180px" });
  });

  it("locks rigid anchors so they cannot be dragged", () => {
    render(
      <JigsawPanel
        blocks={[block({ id: "show", title: "Encore Melaka", weight: 9, fixedTime: true, startMinute: 20 * 60 })]}
        members={members}
      />,
    );

    const anchor = screen.getByRole("button", { name: /Encore Melaka.*locked anchor/ });
    expect(anchor).toBeDisabled();
    expect(anchor).toHaveAttribute("data-anchored", "true");
  });

  it("labels textures from consensus, wishlist, and AI fill", () => {
    render(
      <JigsawPanel
        blocks={[
          block({ id: "agreed", title: "Agreed", satisfaction: { amira: 9, ben: 8 } }),
          block({ id: "wish", title: "Wish", startMinute: 12 * 60, satisfaction: { amira: 9, ben: 2 }, ownerId: "amira" }),
          block({ id: "fill", title: "Fill", startMinute: 14 * 60, satisfaction: { amira: 3, ben: 3 } }),
        ]}
        members={members}
      />,
    );

    expect(screen.getByRole("button", { name: /Agreed/ })).toHaveAttribute("data-texture", "consensus");
    expect(screen.getByRole("button", { name: /Wish/ })).toHaveAttribute("data-texture", "wishlist");
    expect(screen.getByRole("button", { name: /Fill/ })).toHaveAttribute("data-texture", "ai-fill");
  });

  it("raises a conflict alert with the one-click trilemma when blocks overlap", async () => {
    const onResolve = vi.fn();
    render(
      <JigsawPanel
        blocks={[
          block({ id: "jonker", title: "Jonker Street", startMinute: 10 * 60, durationMinutes: 90 }),
          block({ id: "cruise", title: "River Cruise", startMinute: 11 * 60, durationMinutes: 60 }),
        ]}
        members={members}
        onResolve={onResolve}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("1 overlapping block");
    expect(within(alert).getByRole("button", { name: "Shorten Jonker Street" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Replace River Cruise" })).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole("button", { name: "Split into two trajectories" }));
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "split", blockIds: ["jonker", "cruise"] }),
    );
  });

  it("shows no alert when nothing overlaps", () => {
    render(
      <JigsawPanel
        blocks={[
          block({ id: "a", startMinute: 10 * 60, durationMinutes: 60 }),
          block({ id: "b", startMinute: 11 * 60, durationMinutes: 60 }),
        ]}
        members={members}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("moves a block by keyboard and reports the change", async () => {
    const onChange = vi.fn();
    render(
      <JigsawPanel
        blocks={[block({ id: "walk", title: "Riverside walk", startMinute: 10 * 60 })]}
        members={members}
        onChange={onChange}
      />,
    );

    const walk = screen.getByRole("button", { name: /Riverside walk/ });
    walk.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].startMinute).toBe(10 * 60 + SLOT_MINUTES);
    // The label reflects the new position, so a screen reader hears the move.
    expect(screen.getByRole("button", { name: /Riverside walk, 10:30/ })).toBeInTheDocument();
  });

  it("does not move a locked anchor by keyboard", async () => {
    const onChange = vi.fn();
    render(
      <JigsawPanel
        blocks={[block({ id: "show", title: "Encore", weight: 9, fixedTime: true, startMinute: 20 * 60 })]}
        members={members}
        onChange={onChange}
      />,
    );

    screen.getByRole("button", { name: /Encore/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a satisfaction meter per member and flags anyone below the floor", () => {
    render(
      <JigsawPanel
        blocks={[
          block({ id: "loved", title: "Loved", startMinute: 10 * 60, satisfaction: { amira: 10, ben: 1 } }),
          block({ id: "other", title: "Other", startMinute: null, satisfaction: { amira: 1, ben: 10 } }),
        ]}
        members={members}
      />,
    );

    expect(screen.getByRole("meter", { name: "Amira satisfaction" })).toHaveAttribute("aria-valuenow", "100");
    const benMeter = screen.getByRole("meter", { name: "Ben satisfaction" });
    expect(benMeter).toHaveAttribute("aria-valuenow", "10");
  });

  it("suggests a tactical split when the group is too divided", () => {
    render(
      <JigsawPanel
        blocks={[
          block({ id: "loved", title: "Loved", startMinute: 10 * 60, satisfaction: { amira: 10, ben: 1 } }),
          block({ id: "other", title: "Other", startMinute: null, satisfaction: { amira: 1, ben: 10 } }),
        ]}
        members={members}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/tactical split is suggested/i);
  });

  it("lists unplaced blocks as unaccommodated wishes", () => {
    render(
      <JigsawPanel
        blocks={[
          block({ id: "placed", title: "Placed" }),
          block({ id: "pooled", title: "Hotel pool lounge", startMinute: null }),
        ]}
        members={members}
      />,
    );

    const pool = screen.getByLabelText("Unaccommodated wishes");
    expect(within(pool).getByText("Hotel pool lounge")).toBeInTheDocument();
    expect(within(pool).queryByText("Placed")).not.toBeInTheDocument();
  });
});
