// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";

const members = [{ id: "m1", displayName: "Amira", color: "#182544" }];

function mockMatchMedia(initiallyMatches: boolean) {
  let matches = initiallyMatches;
  let listener: ((event: { matches: boolean }) => void) | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(max-width: 768px)",
    addEventListener: (_event: string, callback: typeof listener) => {
      listener = callback;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return {
    fire(next: boolean) {
      matches = next;
      listener?.({ matches: next });
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkspaceShell", () => {
  it("shows both panes side by side above the tablet breakpoint", () => {
    mockMatchMedia(false);
    render(<WorkspaceShell tripName="Melaka" members={members} blocks={[]} />);
    expect(screen.getByLabelText("Spatial map")).toBeInTheDocument();
    expect(screen.getByLabelText("Group chat")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Workspace pane" })).not.toBeInTheDocument();
  });

  it("collapses into tabs below the tablet breakpoint, showing one pane at a time", async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);
    render(<WorkspaceShell tripName="Melaka" members={members} blocks={[]} />);
    expect(screen.getByLabelText("Spatial map")).toBeInTheDocument();
    expect(screen.queryByLabelText("Group chat")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Chat/ }));
    expect(screen.getByLabelText("Group chat")).toBeInTheDocument();
    expect(screen.queryByLabelText("Spatial map")).not.toBeInTheDocument();
  });

  it("reacts live if the viewport crosses the breakpoint", () => {
    const media = mockMatchMedia(false);
    render(<WorkspaceShell tripName="Melaka" members={members} blocks={[]} />);
    expect(screen.queryByRole("tablist", { name: "Workspace pane" })).not.toBeInTheDocument();
    act(() => media.fire(true));
    expect(screen.getByRole("tablist", { name: "Workspace pane" })).toBeInTheDocument();
  });

  it("still opens the pre-trip jigsaw over either layout", async () => {
    const user = userEvent.setup();
    mockMatchMedia(false);
    render(<WorkspaceShell tripName="Melaka" members={members} blocks={[]} />);
    await user.click(screen.getByRole("button", { name: /Timeline jigsaw/ }));
    expect(screen.getByRole("region", { name: "Pre-trip timeline jigsaw" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Spatial map")).not.toBeInTheDocument();
  });
});
