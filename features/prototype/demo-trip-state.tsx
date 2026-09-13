"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { ChatAuthorKind } from "@/lib/chat/repository";
import type { DemoBlock } from "@/lib/prototype/fixtures";
import { DEMO_CHAT_MESSAGES, DEMO_ITINERARY, DEMO_SELF_MEMBER_ID, DEMO_SIGNALS, DEMO_TRIP_ID } from "@/lib/prototype/fixtures";

export type DecisionSource = "signal" | "timeline";

export type DecisionResponse = { agree: boolean; stars: 1 | 2 | 3 | 4 | 5 };

/** What agreeing to a "timeline" decision does to the Plan tab's itinerary: replace (or add, or
 * remove when `result` is null) the one block it describes. Captured at Save time from the
 * Timeline's current state, not recomputed later -- see addTimelineDecision. */
export type DecisionBlockPatch = { blockId: string; result: DemoBlock | null };

export type Decision = {
  id: string;
  source: DecisionSource;
  /** Only meaningful for source: "signal" -- drives ChatSignalCard-style styling/copy. */
  kind?: "soft" | "hard-candidate";
  title: string;
  detail: string;
  /** Only meaningful for source: "signal" -- the chat line this was inferred from. */
  quote?: string;
  forMemberName?: string | null;
  expiresInDays?: number | null;
  createdAt: string;
  response: DecisionResponse | null;
  /** Only meaningful for source: "timeline" -- applied to planBlocks on agree, see respondToDecision. */
  blockPatch: DecisionBlockPatch | null;
};

type DemoTripState = {
  messages: ChatEntry[];
  /** Appends a message as if it were just sent -- used both for the composer's own send and for
   * anything elsewhere in the prototype (e.g. the Timeline's Save button) that needs to post into
   * the same seeded thread. */
  postMessage: (body: string, authorKind?: ChatAuthorKind) => void;
  decisions: Decision[];
  /** Timeline's Save calls this once per pending change (one decision per change, not one per
   * Save click). */
  addTimelineDecision: (change: { text: string; blockPatch?: DecisionBlockPatch }) => void;
  /** The Decisions page calls this once the viewer finalizes a card (agree/disagree + stars are
   * always set together -- there is no partially-resolved decision). Agreeing to a "timeline"
   * decision also applies its blockPatch to planBlocks -- see respondToDecision below. */
  respondToDecision: (id: string, response: DecisionResponse) => void;
  /** The itinerary the Plan tab renders: the seeded trip until a Timeline change is saved *and*
   * agreed to (other members are assumed to agree too, for this prototype -- see
   * respondToDecision). Separate from Timeline's own `blocks` state, which updates immediately
   * on every edit regardless of Save/Agree. */
  planBlocks: DemoBlock[];
};

const DemoTripStateContext = createContext<DemoTripState | null>(null);

function signalToDecision(signal: (typeof DEMO_SIGNALS)[number]): Decision {
  return {
    id: signal.id,
    source: "signal",
    kind: signal.kind,
    title: signal.label,
    detail: signal.detail,
    quote: signal.quote,
    forMemberName: signal.forMemberName,
    expiresInDays: signal.expiresInDays,
    createdAt: new Date(0).toISOString(),
    response: null,
    blockPatch: null,
  };
}

/**
 * Shares the prototype's chat thread and decision queue across routes within one trip. Each
 * /trips/[tripId]/* page is its own React tree, mounted and unmounted as the user switches tabs --
 * without this sitting above them in the layout (which Next.js keeps mounted across those tab
 * switches), a message posted from, say, the Timeline's Save button (or a decision it creates)
 * would have nowhere durable to land, and DemoChat's / DemoDecisions' own local state would forget
 * it the moment the user navigated away and back.
 */
export function DemoTripStateProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatEntry[]>(() => DEMO_CHAT_MESSAGES.map((m) => ({ ...m })));
  const [decisions, setDecisions] = useState<Decision[]>(() => DEMO_SIGNALS.map(signalToDecision));
  const [planBlocks, setPlanBlocks] = useState<DemoBlock[]>(() => DEMO_ITINERARY.map((b) => ({ ...b })));

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

  const addTimelineDecision = useCallback((change: { text: string; blockPatch?: DecisionBlockPatch }) => {
    setDecisions((prev) => [...prev, {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "timeline",
      title: change.text,
      detail: "A change made on the Timeline.",
      forMemberName: null,
      expiresInDays: null,
      createdAt: new Date().toISOString(),
      response: null,
      blockPatch: change.blockPatch ?? null,
    }]);
  }, []);

  /** Agreeing to a "timeline" decision applies its blockPatch to planBlocks right away -- this
   * prototype simulates "everyone in the group agreed" the moment the one interactive viewer
   * does, rather than waiting on the other (non-interactive) members. Disagreeing, or resolving a
   * "signal" decision, never touches planBlocks. */
  const respondToDecision = useCallback((id: string, response: DecisionResponse) => {
    const decision = decisions.find((d) => d.id === id);
    if (response.agree && decision?.blockPatch) {
      const { blockId, result } = decision.blockPatch;
      setPlanBlocks((prev) => {
        if (result === null) return prev.filter((b) => b.id !== blockId);
        return prev.some((b) => b.id === blockId)
          ? prev.map((b) => (b.id === blockId ? result : b))
          : [...prev, result];
      });
    }
    setDecisions((prev) => prev.map((d) => (d.id === id ? { ...d, response } : d)));
  }, [decisions]);

  const value = useMemo(
    () => ({ messages, postMessage, decisions, addTimelineDecision, respondToDecision, planBlocks }),
    [messages, postMessage, decisions, addTimelineDecision, respondToDecision, planBlocks],
  );
  return <DemoTripStateContext.Provider value={value}>{children}</DemoTripStateContext.Provider>;
}

export function useDemoTripState(): DemoTripState {
  const context = useContext(DemoTripStateContext);
  if (!context) throw new Error("useDemoTripState must be used within DemoTripStateProvider");
  return context;
}
