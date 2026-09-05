import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { listMessagesSince, parseChatMessageRow } = vi.hoisted(() => ({
  listMessagesSince: vi.fn(),
  parseChatMessageRow: vi.fn(),
}));
vi.mock("@/lib/chat/repository", () => ({ listMessagesSince, parseChatMessageRow }));

import { openChatChannel } from "@/lib/realtime/channel";

function fakeMessage(id: string, createdAt: string) {
  return { id, tripId: "trip-1", authorMemberId: "member-1", authorKind: "member" as const, body: "hi", proposalId: null, createdAt };
}

function makeChannel() {
  const inserts: Array<(payload: unknown) => void> = [];
  const presenceCallbacks: Array<() => void> = [];
  let subscribeCallback: ((status: string) => void) | null = null;
  const channel = {
    on: vi.fn((type: string, _filter: unknown, callback: (payload: unknown) => void) => {
      if (type === "postgres_changes") inserts.push(callback);
      else presenceCallbacks.push(callback as () => void);
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      subscribeCallback = callback;
      return channel;
    }),
    unsubscribe: vi.fn(),
    presenceState: vi.fn(() => ({ "member-1": [{}] })),
    fireInsert: (payload: unknown) => inserts.forEach((callback) => callback(payload)),
    firePresenceSync: () => presenceCallbacks.forEach((callback) => callback()),
    fireStatus: (status: string) => subscribeCallback?.(status),
  };
  return channel;
}

function makeClient(channel: ReturnType<typeof makeChannel>) {
  return { channel: vi.fn(() => channel) } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.useFakeTimers();
  listMessagesSince.mockReset().mockResolvedValue([]);
  parseChatMessageRow.mockReset().mockImplementation((row) => row);
});
afterEach(() => vi.useRealTimers());

describe("openChatChannel", () => {
  it("subscribes to the trip-scoped channel name", () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    openChatChannel(client, "trip-1", { onMessage: vi.fn() });
    expect(client.channel).toHaveBeenCalledWith("trip:trip-1");
  });

  it("reports connected and backfills once SUBSCRIBED fires", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const onStatusChange = vi.fn();
    openChatChannel(client, "trip-1", { onMessage: vi.fn(), onStatusChange });
    channel.fireStatus("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    expect(onStatusChange).toHaveBeenCalledWith("connected");
    expect(listMessagesSince).toHaveBeenCalledTimes(1);
  });

  it("delivers an insert event directly without a redundant backfill", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const onMessage = vi.fn();
    openChatChannel(client, "trip-1", { onMessage });
    channel.fireStatus("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    listMessagesSince.mockClear();

    channel.fireInsert({ new: fakeMessage("m1", "2026-10-01T00:00:00.000Z") });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    expect(listMessagesSince).not.toHaveBeenCalled();
  });

  it("falls back on a malformed realtime row by re-fetching instead of crashing", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    parseChatMessageRow.mockImplementation(() => {
      throw new Error("bad row");
    });
    openChatChannel(client, "trip-1", { onMessage: vi.fn() });
    channel.fireInsert({ new: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(listMessagesSince).toHaveBeenCalled();
  });

  it("falls back to polling if the socket never reaches SUBSCRIBED", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const onStatusChange = vi.fn();
    openChatChannel(client, "trip-1", { onMessage: vi.fn(), onStatusChange });

    await vi.advanceTimersByTimeAsync(8000);
    expect(onStatusChange).toHaveBeenCalledWith("polling");
    listMessagesSince.mockClear();
    await vi.advanceTimersByTimeAsync(4000);
    expect(listMessagesSince).toHaveBeenCalled();
  });

  it("drops back to polling after a connected socket errors out", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const onStatusChange = vi.fn();
    openChatChannel(client, "trip-1", { onMessage: vi.fn(), onStatusChange });
    channel.fireStatus("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);

    channel.fireStatus("CHANNEL_ERROR");
    expect(onStatusChange).toHaveBeenCalledWith("disconnected");
    await vi.advanceTimersByTimeAsync(4000);
    expect(onStatusChange).toHaveBeenCalledWith("polling");
  });

  it("relays presence sync state", () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const onPresenceSync = vi.fn();
    openChatChannel(client, "trip-1", { onMessage: vi.fn(), onPresenceSync });
    channel.firePresenceSync();
    expect(onPresenceSync).toHaveBeenCalledWith({ "member-1": [{}] });
  });

  it("stops all timers and unsubscribes on close, with no further polling", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const handle = openChatChannel(client, "trip-1", { onMessage: vi.fn() });
    handle.close();
    expect(channel.unsubscribe).toHaveBeenCalled();
    listMessagesSince.mockClear();
    await vi.advanceTimersByTimeAsync(20000);
    expect(listMessagesSince).not.toHaveBeenCalled();
  });
});
