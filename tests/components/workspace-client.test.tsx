// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceClient } from "@/features/workspace/workspace-client";

vi.mock("@/features/chat/chat-pane", () => ({ ChatPane: () => <div /> }));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ proposals: [], trip: {} }), { status: 200 }));
  try { sessionStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const base = {
  tripId: "trip-1", members: [], selfMemberId: null,
  canDecideProposals: false, initialActiveProposalId: null, mapSlot: <div />,
};

describe("WorkspaceClient onboarding nudge", () => {
  it("renders the nudge when onboarding is incomplete", async () => {
    render(<WorkspaceClient {...base} needsOnboarding />);
    expect(await screen.findByRole("link", { name: /Start/ })).toHaveAttribute("href", "/trips/trip-1/onboarding");
  });
  it("omits the nudge when onboarding is complete", async () => {
    render(<WorkspaceClient {...base} needsOnboarding={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
  });
});
