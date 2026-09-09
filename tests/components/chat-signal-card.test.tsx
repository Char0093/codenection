// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ChatSignalCard } from "@/features/prototype/chat-signal-card";
import { DEMO_SIGNALS } from "@/lib/prototype/fixtures";

afterEach(cleanup);

const soft = DEMO_SIGNALS.find((s) => s.kind === "soft")!;
const hard = DEMO_SIGNALS.find((s) => s.kind === "hard-candidate")!;

describe("ChatSignalCard", () => {
  it("confirming a soft signal reports it shapes suggestions for this trip only", async () => {
    const user = userEvent.setup();
    render(<ChatSignalCard signal={soft} />);
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/shaping suggestions for this trip only/i);
    expect(screen.getByRole("status")).toHaveTextContent(/resets on refresh/i);
  });

  it("rejecting leaves it with no effect on the plan", async () => {
    const user = userEvent.setup();
    render(<ChatSignalCard signal={soft} />);
    await user.click(screen.getByRole("button", { name: /reject/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/no effect on the plan/i);
  });

  it("routes a hard-constraint candidate to the named member and never auto-applies it", async () => {
    const user = userEvent.setup();
    render(<ChatSignalCard signal={hard} />);
    expect(screen.getByText(/possible safety constraint/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`for ${hard.forMemberName}`, "i"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(`confirm as ${hard.forMemberName}`, "i") }));
    expect(screen.getByRole("status")).toHaveTextContent(/safety gate/i);
  });

  it("lets you edit the label before confirming", async () => {
    const user = userEvent.setup();
    render(<ChatSignalCard signal={soft} />);
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const field = screen.getByRole("textbox", { name: /edit signal/i });
    await user.clear(field);
    await user.type(field, "rooftop bars");
    await user.click(screen.getByRole("button", { name: /save & confirm/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/shaping suggestions/i);
  });
});
