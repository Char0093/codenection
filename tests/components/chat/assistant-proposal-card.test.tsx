// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantProposalCard } from "@/features/chat/assistant-proposal-card";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

afterEach(() => cleanup());

function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "p1", tripId: "t1", status: "pending", model: "gemini-3.7-flash",
    createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-10-02T00:00:00.000Z", tripRevision: 1,
    payload: { summary: "A day in Melaka", assumptions: [], activities: [] },
    ...overrides,
  };
}

describe("AssistantProposalCard", () => {
  it("shows a graceful fallback when the referenced proposal cannot be found", () => {
    render(<AssistantProposalCard proposal={undefined} />);
    expect(screen.getByText("This suggestion is no longer available.")).toBeInTheDocument();
  });

  it("renders the real proposal review when the proposal is present", () => {
    render(<AssistantProposalCard proposal={proposal()} />);
    expect(screen.getByText("A day in Melaka")).toBeInTheDocument();
  });

  it("only offers a decision when canDecide is set", () => {
    const onDecision = vi.fn();
    render(<AssistantProposalCard proposal={proposal()} canDecide={false} onDecision={onDecision} />);
    expect(screen.queryByRole("button", { name: "Confirm itinerary" })).not.toBeInTheDocument();
    cleanup();
    render(<AssistantProposalCard proposal={proposal()} canDecide onDecision={onDecision} />);
    expect(screen.getByRole("button", { name: "Confirm itinerary" })).toBeInTheDocument();
  });
});
