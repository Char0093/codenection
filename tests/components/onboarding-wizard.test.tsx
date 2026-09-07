// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import type { LegacyOnboardingSnapshot as OnboardingSnapshot } from "@/lib/domain/onboarding-legacy";

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
const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); replace.mockReset(); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function lastPostBody() {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("OnboardingWizard", () => {
  it("gates step 1 on a vibe choice in full mode", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);
    expect(screen.getByRole("heading", { name: "What kind of traveler are you?" })).toBeInTheDocument();
    expect(screen.getByText("Choose the travel style you generally enjoy most.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Food & markets/ }));
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("gates step 4 on a social-role choice in full mode", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("radio", { name: /Food & markets/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 2
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 3
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 4
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Gourmand/ }));
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("walks all five steps and submits every answer", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ profileRevision: 1, needsOnboarding: false }));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);

    await user.click(screen.getByRole("radio", { name: /Heritage & history/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 2
    await user.click(screen.getByRole("button", { name: "Halal" }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 3
    await user.click(screen.getByRole("radio", { name: "Premium" }));
    await user.click(screen.getByRole("radio", { name: "Relaxed" }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 4
    await user.click(screen.getByRole("radio", { name: /Gourmand/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> step 5
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trips/t1/workspace"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/trips/t1/onboarding");
    expect(lastPostBody()).toEqual({
      expectedRevision: 0,
      answers: {
        mode: "full",
        dealbreakers: { dietary: ["halal"], religiousAccess: [], mobility: [] },
        walkingCapM: null,
        budgetLean: "premium",
        vibe: "heritage",
        pace: "relaxed",
        socialRole: "gourmand",
        surpriseDial: 3,
      },
    });
  });

  it("collapses to two screens in quick mode", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ profileRevision: 1, needsOnboarding: false }));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));            // -> budget screen
    await user.click(screen.getByRole("radio", { name: "Budget" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastPostBody().answers).toEqual({
      mode: "quick",
      dealbreakers: { dietary: [], religiousAccess: [], mobility: [] },
      walkingCapM: null,
      budgetLean: "budget",
    });
  });

  it("lets a member return from Quick mode to the full survey", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Quick mode/ })).not.toBeChecked();
  });

  it("keeps entered answers when going Back", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("radio", { name: /Nature & outdoors/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("radio", { name: /Nature & outdoors/ })).toBeChecked();
  });

  it("locks an already-confirmed dealbreaker and points removal to the right place per kind", async () => {
    const user = userEvent.setup();
    const snapshot: OnboardingSnapshot = {
      ...emptySnapshot,
      dealbreakers: {
        ...emptySnapshot.dealbreakers,
        dietary: { confirmed: ["halal"], pending: [] },
        religiousAccess: { confirmed: ["prayer_space_needed"], pending: [] },
        mobility: { confirmed: ["no_stairs"], pending: [] },
      },
    };
    render(<OnboardingWizard tripId="t1" initial={snapshot} successHref="/x" />);
    await user.click(screen.getByRole("radio", { name: /Urban & nightlife/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    const dietaryChip = screen.getByRole("button", { name: "Halal" });
    expect(dietaryChip).toBeDisabled();
    expect(dietaryChip).toHaveAttribute("aria-pressed", "true");
    // Dietary removal has a real path (the dashboard picker), so the tooltip may point there.
    expect(dietaryChip.getAttribute("title")).toContain("dashboard");

    // Religious-access and mobility have no removal path in this slice -> must NOT point at the dashboard.
    for (const name of ["Prayer space needed", "Avoid stairs"]) {
      const chip = screen.getByRole("button", { name });
      expect(chip).toBeDisabled();
      expect(chip.getAttribute("title")).not.toContain("dashboard");
    }
  });

  it("shows a Reload affordance on a stale response and resends the refetched revision", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "changed elsewhere", code: "STALE_PROFILE" }, 409))
      .mockResolvedValueOnce(jsonResponse({ ...emptySnapshot, profileRevision: 4 }))
      .mockResolvedValueOnce(jsonResponse({ profileRevision: 5, needsOnboarding: false }));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/trips/t1/workspace" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const reload = await screen.findByRole("button", { name: "Reload" });
    await user.click(reload);
    // wizard reseeded to step 1 (mode preserved as quick); redo the quick flow
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastPostBody().expectedRevision).toBe(4);
  });

  it("replaces confirmed and pending chip metadata when a stale snapshot is reloaded", async () => {
    const user = userEvent.setup();
    const refreshed: OnboardingSnapshot = {
      ...emptySnapshot,
      profileRevision: 4,
      dealbreakers: {
        dietary: { confirmed: ["halal"], pending: [] },
        religiousAccess: { confirmed: [], pending: [] },
        mobility: { confirmed: [], pending: ["no_stairs"] },
      },
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "changed elsewhere", code: "STALE_PROFILE" }, 409))
      .mockResolvedValueOnce(jsonResponse(refreshed));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "Reload" }));

    expect(screen.getByRole("button", { name: "Halal" })).toBeDisabled();
    const pending = screen.getByRole("button", { name: "Avoid stairs (suggested)" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("title", "Suggested — review coming soon");
  });

  it("surfaces a generic error and stays on the step", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope", code: "PENDING_CONSTRAINT" }, 409));
    render(<OnboardingWizard tripId="t1" initial={emptySnapshot} successHref="/x" />);
    await user.click(screen.getByRole("checkbox", { name: /Quick mode/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("radio", { name: "Standard" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(replace).not.toHaveBeenCalled();
  });
});
