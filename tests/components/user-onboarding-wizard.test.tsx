// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import type { OnboardingSnapshot } from "@/lib/domain/onboarding";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));

const emptySnapshot: OnboardingSnapshot = {
  profile: null,
  profileRevision: 0,
  dealbreakers: {
    dietary: { confirmed: [], pending: [] },
    religiousAccess: { confirmed: [], pending: [] },
    mobility: { confirmed: [], pending: [] },
  },
  needsOnboarding: true,
};

const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const lastPostBody = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); replace.mockReset(); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("UserOnboardingWizard", () => {
  it("starts on the safety screen with Next always enabled", () => {
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/" />);
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("shows a completion summary of the picked answers before redirecting", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ profileRevision: 1, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/chats" />);
    await user.click(screen.getByRole("button", { name: "Halal" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: /you.re all set/i })).toBeInTheDocument();
    expect(screen.getByText("Halal")).toBeInTheDocument();
    expect(screen.getByText("Balanced default")).toBeInTheDocument();
    // The footer/step chrome is gone in the completion view, not just visually covered.
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chats"), { timeout: 2000 });
  });

  it("submits an empty safety vault and a skipped dial, then redirects", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ profileRevision: 1, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/chats" />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: /balanced default/i })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    // The "you're all set" summary holds briefly before the redirect (see the component's
    // finished-state effect) -- give waitFor room for that transition, not just a network tick.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chats"), { timeout: 2000 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/onboarding");
    expect(lastPostBody()).toEqual({
      expectedRevision: 0,
      answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: null },
    });
  });

  it("includes picked safety flags and a set dial", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ profileRevision: 1, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/" endpoint="/api/onboarding" />);
    await user.click(screen.getByRole("button", { name: "Halal" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: /customize/i })); // un-skip
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastPostBody().answers).toEqual({
      dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] },
      surpriseDial: 1,
    });
  });

  it("locks an already-confirmed flag", () => {
    render(<UserOnboardingWizard successHref="/" initial={{
      ...emptySnapshot,
      dealbreakers: { ...emptySnapshot.dealbreakers, dietary: { confirmed: ["halal"], pending: [] } },
    }} />);
    const chip = screen.getByRole("button", { name: "Halal" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("seeds the dial from a completed profile and keeps it unless skipped", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json({ profileRevision: 8, needsOnboarding: false }));
    render(<UserOnboardingWizard successHref="/preferences" initial={{
      ...emptySnapshot,
      profileRevision: 7,
      profile: { travelVibe: null, serendipityEpsilon: 0.3, onboardingCompletedAt: "2026-09-07T00:00:00Z" },
    }} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: /customize/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider")).toHaveValue("5");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/preferences"), { timeout: 2000 });
    expect(lastPostBody()).toEqual({
      expectedRevision: 7,
      answers: { dealbreakers: { dietary: [], religiousAccess: [], mobility: [] }, surpriseDial: 5 },
    });
  });

  it("recovers from a stale 409 by reloading and resubmitting the refetched revision", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(json({ error: "changed", code: "STALE_PROFILE" }, 409))
      .mockResolvedValueOnce(json({ ...emptySnapshot, profileRevision: 4 }))
      .mockResolvedValueOnce(json({ profileRevision: 5, needsOnboarding: false }));
    render(<UserOnboardingWizard initial={emptySnapshot} successHref="/chats" />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByText("Step 1 of 2")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chats"), { timeout: 2000 });
    expect(lastPostBody().expectedRevision).toBe(4);
  });
});
