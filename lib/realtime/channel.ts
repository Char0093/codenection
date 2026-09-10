import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { listMessagesSince, parseChatMessageRow, type ChatMessage } from "@/lib/chat/repository";

export type ChatConnectionStatus = "connecting" | "connected" | "disconnected" | "polling";

export type ChatChannelHandlers = {
  onMessage: (message: ChatMessage) => void;
  onPresenceSync?: (state: Record<string, unknown[]>) => void;
  onStatusChange?: (status: ChatConnectionStatus) => void;
  /** Fired when another member reports they are composing. Never fired for your own pings. */
  onTyping?: (memberId: string) => void;
};

export type ChatChannelHandle = {
  close: () => void;
  /** Broadcasts "I am composing" to the other members. Cheap and lossy by design. */
  sendTyping: (memberId: string) => void;
};

const POLL_INTERVAL_MS = 4000;
const CONNECT_TIMEOUT_MS = 8000;
const TYPING_EVENT = "typing";

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
    // Typing is ephemeral: a broadcast, never a row. Nothing is stored, a dropped ping just
    // means the dots do not appear, and no schema or RLS policy is involved.
    .on("broadcast", { event: TYPING_EVENT }, (payload) => {
      const memberId = (payload as { payload?: { memberId?: unknown } } | undefined)?.payload?.memberId;
      if (typeof memberId === "string" && memberId) handlers.onTyping?.(memberId);
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
    sendTyping: (memberId: string) => {
      // Best-effort only. A typing ping is worth nothing once it is late, so a closed channel,
      // a transport without broadcast support, or a rejected send is all silently dropped
      // rather than surfaced or retried.
      if (closed || !memberId) return;
      const send = (channel as { send?: (args: unknown) => unknown }).send;
      if (typeof send !== "function") return;
      try {
        void send.call(channel, { type: "broadcast", event: TYPING_EVENT, payload: { memberId } });
      } catch {
        // Ignored: see above.
      }
    },
  };
}
