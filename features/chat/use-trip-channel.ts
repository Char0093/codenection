"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listMessages, sendMessage, type ChatMessage } from "@/lib/chat/repository";
import { openChatChannel, type ChatConnectionStatus } from "@/lib/realtime/channel";

/** A message plus client-only delivery state. Never sent to or read from the server. */
export type ChatEntry = ChatMessage & { pending?: boolean; failed?: boolean };

export function useTripChannel(tripId: string, selfMemberId: string | null) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");
  const [presentMemberIds, setPresentMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const client = useRef(createClient());
  const messagesRef = useRef<ChatEntry[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setMessages([]);
    listMessages(client.current, tripId)
      .then((initial) => {
        if (!cancelled) setMessages(initial);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Unable to load chat history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const handle = openChatChannel(client.current, tripId, {
      onMessage: (message) =>
        setMessages((existing) => (existing.some((entry) => entry.id === message.id) ? existing : [...existing, message])),
      onStatusChange: setStatus,
      onPresenceSync: (state) => setPresentMemberIds(Object.keys(state)),
    });
    return () => {
      cancelled = true;
      handle.close();
    };
  }, [tripId]);

  const deliver = useCallback(
    async (localId: string, body: string) => {
      if (!selfMemberId) return;
      try {
        const sent = await sendMessage(client.current, tripId, selfMemberId, body);
        setMessages((existing) => existing.map((entry) => (entry.id === localId ? sent : entry)));
      } catch {
        setMessages((existing) => existing.map((entry) => (entry.id === localId ? { ...entry, pending: false, failed: true } : entry)));
      }
    },
    [tripId, selfMemberId],
  );

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || !selfMemberId) return;
      const localId = "pending-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const optimistic: ChatEntry = {
        id: localId, tripId, authorMemberId: selfMemberId, authorKind: "member",
        body: trimmed, proposalId: null, createdAt: new Date().toISOString(), pending: true,
      };
      setMessages((existing) => [...existing, optimistic]);
      await deliver(localId, trimmed);
    },
    [tripId, selfMemberId, deliver],
  );

  const retry = useCallback(
    (localId: string) => {
      const target = messagesRef.current.find((entry) => entry.id === localId);
      if (!target) return;
      setMessages((existing) => existing.map((entry) => (entry.id === localId ? { ...entry, pending: true, failed: false } : entry)));
      void deliver(localId, target.body);
    },
    [deliver],
  );

  return { messages, status, presentMemberIds, loading, loadError, send, retry };
}
