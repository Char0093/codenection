// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MessageList } from "@/features/chat/message-list";
import type { ChatEntry } from "@/features/chat/use-trip-channel";

afterEach(() => cleanup());

const MEMBERS = [
  { id: "m1", displayName: "You", color: "#e07a5f" },
  { id: "m2", displayName: "Mei", color: "#2a9d8f" },
  { id: "m3", displayName: "Arun", color: "#7d5ba6" },
];

function message(overrides: Partial<ChatEntry> & { id: string }): ChatEntry {
  return {
    tripId: "trip-1", authorMemberId: "m2", authorKind: "member",
    body: "hello", proposalId: null, createdAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function renderList(props: Partial<React.ComponentProps<typeof MessageList>> = {}) {
  return render(
    <MessageList
      messages={[message({ id: "a" })]}
      members={MEMBERS}
      selfMemberId="m1"
      onRetry={() => {}}
      {...props}
    />,
  );
}

describe("typing indicator", () => {
  it("stays out of the thread when nobody is composing", () => {
    renderList({ typingMemberIds: [] });
    expect(document.querySelector(".chat-typing")).toBeNull();
  });

  it("names the single member who is composing", () => {
    renderList({ typingMemberIds: ["m2"] });
    expect(screen.getByText("Mei is typing")).toBeTruthy();
  });

  it("names both members when two are composing", () => {
    renderList({ typingMemberIds: ["m2", "m3"] });
    expect(screen.getByText("Mei and Arun are typing")).toBeTruthy();
  });

  it("summarises a crowd rather than listing everyone", () => {
    renderList({ typingMemberIds: ["m2", "m3", "m1"] });
    expect(screen.getByText("Mei and 2 others are typing")).toBeTruthy();
  });

  it("falls back to a neutral label for an unknown member id", () => {
    renderList({ typingMemberIds: ["ghost"] });
    expect(screen.getByText("Someone is typing")).toBeTruthy();
  });

  it("renders as an incoming bubble so it inherits the thread geometry", () => {
    renderList({ typingMemberIds: ["m2"] });
    const bubble = document.querySelector(".chat-typing");
    expect(bubble?.getAttribute("data-self")).toBe("false");
    expect(bubble?.querySelectorAll(".chat-typing-dots span")).toHaveLength(3);
  });
});

describe("delivery receipt", () => {
  it("marks only the newest sent outgoing message as delivered", () => {
    renderList({
      messages: [
        message({ id: "a", authorMemberId: "m1", body: "first" }),
        message({ id: "b", authorMemberId: "m1", body: "second" }),
      ],
    });
    expect(screen.getAllByText("Delivered")).toHaveLength(1);
  });

  it("shows Sending rather than Delivered while a message is in flight", () => {
    renderList({ messages: [message({ id: "a", authorMemberId: "m1", pending: true })] });
    expect(screen.getByText("Sending...")).toBeTruthy();
    expect(screen.queryByText("Delivered")).toBeNull();
  });

  it("shows neither receipt on a failed message", () => {
    renderList({ messages: [message({ id: "a", authorMemberId: "m1", failed: true })] });
    expect(screen.queryByText("Delivered")).toBeNull();
    expect(screen.getByText(/Not sent/)).toBeTruthy();
  });

  it("never marks an incoming message as delivered", () => {
    renderList({ messages: [message({ id: "a", authorMemberId: "m2" })] });
    expect(screen.queryByText("Delivered")).toBeNull();
  });
});

describe("tapbacks", () => {
  it("offers no reaction affordance without a handler", () => {
    renderList();
    expect(screen.queryByRole("button", { name: /React to message/ })).toBeNull();
  });

  it("opens the six-glyph strip and reports the chosen reaction", async () => {
    const onReact = vi.fn();
    renderList({ onReact });
    await userEvent.click(screen.getByRole("button", { name: /React to message/ }));
    const strip = screen.getByRole("group", { name: "React to this message" });
    expect(within(strip).getAllByRole("button")).toHaveLength(6);
    await userEvent.click(within(strip).getByRole("button", { name: "Heart" }));
    expect(onReact).toHaveBeenCalledWith("a", "heart");
  });

  it("clears a reaction when the active one is chosen again", async () => {
    const onReact = vi.fn();
    renderList({ onReact, reactions: { a: "heart" } });
    await userEvent.click(screen.getByRole("button", { name: /React to message/ }));
    const strip = screen.getByRole("group", { name: "React to this message" });
    await userEvent.click(within(strip).getByRole("button", { name: "Heart" }));
    expect(onReact).toHaveBeenCalledWith("a", null);
  });

  it("docks the chosen reaction as a chip on the bubble", () => {
    renderList({ onReact: vi.fn(), reactions: { a: "haha" } });
    const chip = document.querySelector(".tapback-chip");
    expect(chip?.getAttribute("data-tapback")).toBe("haha");
    expect(screen.getByText("Ha ha")).toBeTruthy();
  });

  it("dismisses the strip on Escape", async () => {
    renderList({ onReact: vi.fn() });
    await userEvent.click(screen.getByRole("button", { name: /React to message/ }));
    expect(screen.getByRole("group", { name: "React to this message" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "React to this message" })).toBeNull();
  });

  it("does not offer reactions on a system notice", () => {
    renderList({ onReact: vi.fn(), messages: [message({ id: "a", authorKind: "system", authorMemberId: null })] });
    expect(screen.queryByRole("button", { name: /React to message/ })).toBeNull();
  });

  it("does not offer reactions on a message still in flight", () => {
    renderList({ onReact: vi.fn(), messages: [message({ id: "a", authorMemberId: "m1", pending: true })] });
    expect(screen.queryByRole("button", { name: /React to message/ })).toBeNull();
  });
});
