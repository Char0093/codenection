import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { listMessagesSince, parseChatMessageRow, type ChatMessage } from "@/lib/chat/repository";

export type ChatConnectionStatus = "connecting" | "connected" | "disconnected" | "polling";

export type ChatChannelHandlers = {
  onMessage: (message: ChatMessage) => void;
  onPresenceSync?: (state: Record<string, unknown[]>) => void;
  onStatusChange?: (status: ChatConnectionStatus) => void;
};

export type ChatChannelHandle = { close: () => void };

const POLL_INTERVAL_MS = 4000;
const CONNECT_TIMEOUT_MS = 8000;

/**
 * Subscribes to a trip's realtime chat channel (Task 3.1). A dropped socket cannot silently lose
 * messages: every reconnect backfills anything newer than the last message seen, and if the
 * socket never reaches SUBSCRIBED within CONNECT_TIMEOUT_MS this falls back to polling instead of
 * leaving the chat frozen.
 */
export function openChatChannel(client: SupabaseClient, tripId: string, handlers: ChatChannelHandlers): ChatChannelHandle {
  let lastSeenAt = new Date(0).toISOString();
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  function noteMessage(message: ChatMessage) {
    if (message.createdAt > lastSeenAt) lastSeenAt = message.createdAt;
    handlers.onMessage(message);
  }

  async function backfill() {
    const gap = await listMessagesSince(client, tripId, lastSeenAt);
    for (const message of gap) noteMessage(message);
  }

  function startPolling() {
    if (pollTimer || closed) return;
    handlers.onStatusChange?.("polling");
    pollTimer = setInterval(() => void backfill(), POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  handlers.onStatusChange?.("connecting");
  connectTimer = setTimeout(startPolling, CONNECT_TIMEOUT_MS);

  const channel: RealtimeChannel = client
    .channel("trip:" + tripId)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: "trip_id=eq." + tripId },
      (payload) => {
        try {
          noteMessage(parseChatMessageRow(payload.new));
        } catch {
          // A row shaped unexpectedly is a signal to re-fetch, not to crash the channel.
          void backfill();
        }
      },
    )
    .on("presence", { event: "sync" }, () => {
      handlers.onPresenceSync?.(channel.presenceState());
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        stopPolling();
        handlers.onStatusChange?.("connected");
        void backfill();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (!closed) {
          handlers.onStatusChange?.("disconnected");
          startPolling();
        }
      }
    });

  return {
    close: () => {
      closed = true;
      if (connectTimer) clearTimeout(connectTimer);
      stopPolling();
      void channel.unsubscribe();
    },
  };
}
