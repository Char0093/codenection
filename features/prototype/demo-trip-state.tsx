"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { ChatAuthorKind } from "@/lib/chat/repository";
import { DEMO_CHAT_MESSAGES, DEMO_SELF_MEMBER_ID, DEMO_TRIP_ID } from "@/lib/prototype/fixtures";

type DemoTripState = {
  messages: ChatEntry[];
  /** Appends a message as if it were just sent -- used both for the composer's own send and for
   * anything elsewhere in the prototype (e.g. the Timeline's Save button) that needs to post into
   * the same seeded thread. */
  postMessage: (body: string, authorKind?: ChatAuthorKind) => void;
};

const DemoTripStateContext = createContext<DemoTripState | null>(null);

/**
 * Shares the prototype's chat thread across routes within one trip. Each /trips/[tripId]/* page
 * is its own React tree, mounted and unmounted as the user switches tabs -- without this sitting
 * above them in the layout (which Next.js keeps mounted across those tab switches), a message
 * posted from, say, the Timeline's Save button would have nowhere durable to land, and DemoChat's
 * own local state would forget it the moment the user navigated away and back.
 */
export function DemoTripStateProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatEntry[]>(() => DEMO_CHAT_MESSAGES.map((m) => ({ ...m })));

  const postMessage = useCallback((body: string, authorKind: ChatAuthorKind = "member") => {
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tripId: DEMO_TRIP_ID,
      authorMemberId: authorKind === "member" ? DEMO_SELF_MEMBER_ID : null,
      authorKind,
      body,
      proposalId: null,
      createdAt: new Date().toISOString(),
    }]);
  }, []);

  const value = useMemo(() => ({ messages, postMessage }), [messages, postMessage]);
  return <DemoTripStateContext.Provider value={value}>{children}</DemoTripStateContext.Provider>;
}

export function useDemoTripState(): DemoTripState {
  const context = useContext(DemoTripStateContext);
  if (!context) throw new Error("useDemoTripState must be used within DemoTripStateProvider");
  return context;
}
