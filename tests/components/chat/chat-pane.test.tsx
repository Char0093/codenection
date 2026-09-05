// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPane } from "@/features/chat/chat-pane";
import type { ChatMessage } from "@/lib/chat/repository";

const { listMessages, sendMessage, openChatChannel } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  sendMessage: vi.fn(),
  openChatChannel: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/chat/repository", () => ({ listMessages, sendMessage }));
vi.mock("@/lib/realtime/channel", () => ({ openChatChannel }));

const tripId = "11111111-1111-4111-8111-111111111111";
const amiraId = "22222222-2222-4222-8222-222222222222";
const benId = "33333333-3333-4333-8333-333333333333";
const members = [
  { id: amiraId, displayName: "Amira", color: "#182544" },
  { id: benId, displayName: "Ben", color: "#a6432e" },
];

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1", tripId, authorMemberId: amiraId, authorKind: "member",
    body: "Hello", proposalId: null, createdAt: "2026-10-01T00:00:00.000Z", ...overrides,
  };
}

let capturedHandlers: { onMessage: (m: ChatMessage) => void; onPresenceSync?: (s: Record<string, unknown[]>) => void; onStatusChange?: (s: string) => void } | null = null;
const closeChannel = vi.fn();

afterEach(() => {
  cleanup();
  listMessages.mockReset();
  sendMessage.mockReset();
  openChatChannel.mockReset();
  closeChannel.mockReset();
  capturedHandlers = null;
});

function setup(initial: ChatMessage[] = []) {
  listMessages.mockResolvedValue(initial);
  openChatChannel.mockImplementation((_client: unknown, _tripId: string, handlers: typeof capturedHandlers) => {
    capturedHandlers = handlers;
    return { close: closeChannel };
  });
}

describe("ChatPane", () => {
  it("renders each author's name and avatar initial", async () => {
    setup([message({ id: "a", authorMemberId: amiraId, body: "Hi from Amira" }), message({ id: "b", authorMemberId: benId, body: "Hi from Ben" })]);
    render(<ChatPane tripId={tripId} selfMemberId={amiraId} members={members} />);
    expect(await screen.findByText("Hi from Amira")).toBeInTheDocument();
    expect(screen.getByText("Hi from Ben")).toBeInTheDocument();
    expect(screen.getByText("Amira")).toBeInTheDocument();
    expect(screen.getByText("Ben")).toBeInTheDocument();
  });

  it("queries only the given trip, never a different one", async () => {
    setup([]);
    render(<ChatPane tripId={tripId} selfMemberId={amiraId} members={members} />);
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith(expect.anything(), tripId));
    expect(openChatChannel).toHaveBeenCalledWith(expect.anything(), tripId, expect.anything());
  });

  it("shows and removes presence avatars as members join and leave", async () => {
    setup([]);
    render(<ChatPane tripId={tripId} selfMemberId={amiraId} members={members} />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());
    expect(screen.queryByLabelText("Viewing now")).not.toBeInTheDocument();

    capturedHandlers!.onPresenceSync?.({ [benId]: [{}] });
    expect(await screen.findByLabelText("Viewing now")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Viewing now")).getByTitle("Ben")).toBeInTheDocument();

    capturedHandlers!.onPresenceSync?.({});
    await waitFor(() => expect(screen.queryByLabelText("Viewing now")).not.toBeInTheDocument());
  });

  it("sends optimistically, then surfaces a retry affordance on failure", async () => {
    const user = userEvent.setup();
    setup([]);
    let rejectSend: (error: unknown) => void = () => {};
    sendMessage.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    render(<ChatPane tripId={tripId} selfMemberId={amiraId} members={members} />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    await user.type(screen.getByLabelText("Message"), "Let's go to Jonker Street");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Let's go to Jonker Street")).toBeInTheDocument();
    expect(screen.getByText("Sending...")).toBeInTheDocument();

    rejectSend(new Error("network down"));
    expect(await screen.findByText("Not sent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("retries a failed message and clears the failure once it succeeds", async () => {
    const user = userEvent.setup();
    setup([]);
    sendMessage.mockRejectedValueOnce(new Error("network down"));
    render(<ChatPane tripId={tripId} selfMemberId={amiraId} members={members} />);
    await waitFor(() => expect(capturedHandlers).not.toBeNull());

    await user.type(screen.getByLabelText("Message"), "Retry me");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Not sent.");

    sendMessage.mockResolvedValueOnce(message({ id: "server-id", body: "Retry me" }));
    await user.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByText("Not sent.")).not.toBeInTheDocument());
    expect(screen.getByText("Retry me")).toBeInTheDocument();
  });

  it("styles assistant turns distinctly from member turns", async () => {
    setup([message({ id: "sys", authorMemberId: null, authorKind: "assistant", body: "Here is a suggestion" })]);
    render(<ChatPane tripId={tripId} selfMemberId={amiraId} members={members} />);
    const bubble = await screen.findByText("Here is a suggestion");
    expect(bubble.closest("li")).toHaveAttribute("data-author-kind", "assistant");
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("disables the composer for a viewer with no membership row", () => {
    setup([]);
    render(<ChatPane tripId={tripId} selfMemberId={null} members={members} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});
