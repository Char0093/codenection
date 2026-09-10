"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listMessages, sendMessage, type ChatMessage } from "@/lib/chat/repository";
import { openChatChannel, type ChatConnectionStatus } from "@/lib/realtime/channel";

/** A message plus client-only delivery state. Never sent to or read from the server. */
export type ChatEntry = ChatMessage & { pending?: boolean; failed?: boolean };

/** How long a typing ping keeps the dots up before it is assumed stale. */
const TYPING_TTL_MS = 4000;
/** Minimum gap between outgoing pings, so a fast typist sends a trickle, not a flood. */
const TYPING_THROTTLE_MS = 2000;

export function useTripChannel(tripId: string, selfMemberId: string | null) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");
  const [presentMemberIds, setPresentMemberIds] = useState<string[]>([]);
  const [typingMemberIds, setTypingMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const client = useRef(createClient());
  const messagesRef = useRef<ChatEntry[]>([]);
  // sendTyping is optional here on purpose: a typing ping must never be able to throw into a
  // keystroke handler if the channel handle predates it or is stubbed without it.
  const handleRef = useRef<{ sendTyping?: (memberId: string) => void } | null>(null);
  const lastTypingSentAt = useRef(0);
  // memberId -> timer that clears that member's dots once their ping goes stale.
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const selfMemberIdRef = useRef(selfMemberId);
  useEffect(() => {
    selfMemberIdRef.current = selfMemberId;
  }, [selfMemberId]);
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

    const timers = typingTimers.current;
    const handle = openChatChannel(client.current, tripId, {
      onMessage: (message) => {
        setMessages((existing) => (existing.some((entry) => entry.id === message.id) ? existing : [...existing, message]));
        // A member who just sent something is no longer composing; drop their dots immediately
        // rather than leaving them up for the rest of the TTL.
        if (message.authorMemberId) clearTyping(message.authorMemberId);
      },
      onStatusChange: setStatus,
      onPresenceSync: (state) => setPresentMemberIds(Object.keys(state)),
      onTyping: (memberId) => {
        if (memberId === selfMemberIdRef.current) return;
        setTypingMemberIds((existing) => (existing.includes(memberId) ? existing : [...existing, memberId]));
        const existingTimer = timers.get(memberId);
        if (existingTimer) clearTimeout(existingTimer);
        timers.set(memberId, setTimeout(() => clearTyping(memberId), TYPING_TTL_MS));
      },
    });
    handleRef.current = handle;

    function clearTyping(memberId: string) {
      const timer = timers.get(memberId);
      if (timer) clearTimeout(timer);
      timers.delete(memberId);
      setTypingMemberIds((existing) => (existing.includes(memberId) ? existing.filter((id) => id !== memberId) : existing));
    }

    return () => {
      cancelled = true;
      handleRef.current = null;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      setTypingMemberIds([]);
      handle.close();
    };
  }, [tripId]);

  /**
   * Announces that this member is composing. Throttled, so holding a key down sends one ping
   * every TYPING_THROTTLE_MS rather than one per keystroke.
   */
  const notifyTyping = useCallback(() => {
    if (!selfMemberId) return;
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    handleRef.current?.sendTyping?.(selfMemberId);
  }, [selfMemberId]);

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

  return { messages, status, presentMemberIds, typingMemberIds, loading, loadError, send, retry, notifyTyping };
}
