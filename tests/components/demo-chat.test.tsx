// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoChat } from "@/features/prototype/demo-chat";
import { DEMO_TRIP_ID } from "@/lib/prototype/fixtures";

afterEach(cleanup);

describe("DemoChat invite link", () => {
  it("shows an Invite control in the chat header", () => {
    render(<DemoChat />);
    const invite = screen.getByRole("button", { name: /invite/i });
    expect(invite).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals a shareable invite link for this trip when Invite is clicked", async () => {
    const user = userEvent.setup();
    render(<DemoChat />);

    await user.click(screen.getByRole("button", { name: /invite/i }));

    const field = screen.getByLabelText(/invite link/i) as HTMLInputElement;
    expect(field.value).toContain(`/trips/${DEMO_TRIP_ID}/entry`);
    expect(field.value).toContain("invite=");
  });

  it("copies the invite link to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<DemoChat />);

    await user.click(screen.getByRole("button", { name: /invite/i }));
    const link = (screen.getByLabelText(/invite link/i) as HTMLInputElement).value;
    await user.click(screen.getByRole("button", { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("still confirms a copy when the clipboard API is blocked, via execCommand fallback", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const exec = vi.fn().mockReturnValue(true);
    // jsdom has no execCommand implementation; install one for this test.
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    render(<DemoChat />);

    await user.click(screen.getByRole("button", { name: /invite/i }));
    await user.click(screen.getByRole("button", { name: /copy link/i }));

    expect(exec).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});
