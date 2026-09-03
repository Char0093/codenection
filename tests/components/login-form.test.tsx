// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const { signInWithOtp } = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOtp } }) }));
afterEach(() => { cleanup(); signInWithOtp.mockReset(); window.history.replaceState(null, "", "/"); });
it("sends a magic link to the same-origin callback", async () => {
  const user = userEvent.setup();
  signInWithOtp.mockResolvedValue({ error: null });
  render(<LoginForm configured />);
  await user.type(screen.getByLabelText("Email"), "planner@example.com");
  await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
  expect(signInWithOtp).toHaveBeenCalledWith({ email: "planner@example.com", options: { emailRedirectTo: window.location.origin + "/auth/callback" } });
  expect(await screen.findByRole("status")).toHaveTextContent("Sign-in link sent. Check your email.");
});
it("disables submission without configuration", () => {
  render(<LoginForm configured={false} />);
  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByText("Waypoint")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeDisabled();
  expect(screen.getByText("Sign-in is not configured yet.")).toBeInTheDocument();
});
it("shows expired magic-link errors from the callback", async () => {
  window.history.replaceState(null, "", "/login?error=link_expired");
  render(<LoginForm configured />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This sign-in link has expired. Request a new link.");
});
it("shows authentication errors and permits retry", async () => {
  const user = userEvent.setup();
  signInWithOtp.mockResolvedValue({ error: { message: "Too many requests" } });
  render(<LoginForm configured />);
  await user.type(screen.getByLabelText("Email"), "planner@example.com");
  await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeEnabled();
});
