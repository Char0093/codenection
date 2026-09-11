"use client";

import React, { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { MessageList } from "@/features/chat/message-list";
import { Composer } from "@/features/chat/composer";
import { ChatHeader } from "@/features/chat/chat-header";
import { GroupInfo } from "@/features/chat/group-info";
import { ChatSignalCard } from "@/features/prototype/chat-signal-card";
import { InvitePanel } from "@/features/prototype/invite-panel";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { Tapback } from "@/features/chat/tapback";
import { shouldAddressAssistant } from "@/lib/chat/mention";
import {
  DEMO_CHAT_MESSAGES, DEMO_MEMBERS, DEMO_SELF_MEMBER_ID, DEMO_SIGNALS, DEMO_TRIP, DEMO_TRIP_ID,
} from "@/lib/prototype/fixtures";

/**
 * The assistant is not a trip member, so it has no row in DEMO_MEMBERS. This pseudo-member
 * exists purely so the typing indicator can name it; no message is ever authored against this
 * id, and it is not counted in the member total shown in the header.
 */
const ASSISTANT_TYPING = { id: "demo-assistant-typing", displayName: "Assistant", color: "#af52de" };
const DEMO_ASSISTANT_TYPING_ID = ASSISTANT_TYPING.id;

/** Prototype chat: the real MessageList + Composer over seeded messages, plus the assistant's
 *  chat-preference-extraction panel. Sending a message that addresses the assistant appends a
 *  canned reply. Nothing leaves the browser and nothing persists. */
export function DemoChat() {
  const [messages, setMessages] = useState<ChatEntry[]>(() => DEMO_CHAT_MESSAGES.map((m) => ({ ...m })));
  // The prototype drives the same typing/tapback props the live pane does, from local state.
  const [typingMemberIds, setTypingMemberIds] = useState<string[]>([]);
  const [reactions, setReactions] = useState<Record<string, Tapback>>({});
  // Pressing the header swaps the thread for the group-info view (wireframe panels 2-3).
  const [showInfo, setShowInfo] = useState(false);

  function react(messageId: string, tapback: Tapback | null) {
    setReactions((existing) => {
      if (!tapback) {
        const { [messageId]: _removed, ...rest } = existing;
        return rest;
      }
      return { ...existing, [messageId]: tapback };
    });
  }

  function send(body: string) {
    const now = new Date().toISOString();
    const mine: ChatEntry = {
      id: `local-${Date.now()}`, tripId: DEMO_TRIP_ID, authorMemberId: DEMO_SELF_MEMBER_ID,
      authorKind: "member", body, proposalId: null, createdAt: now,
    };
    setMessages((prev) => [...prev, mine]);
    if (!shouldAddressAssistant(body)) return;
    // Show the assistant composing while its canned reply is pending -- the same dots the
    // live pane renders from a real broadcast, driven here by a timer.
    setTypingMemberIds([DEMO_ASSISTANT_TYPING_ID]);
    window.setTimeout(() => {
      setTypingMemberIds([]);
      setMessages((prev) => [...prev, {
        id: `assist-${Date.now()}`, tripId: DEMO_TRIP_ID, authorMemberId: null, authorKind: "assistant",
        body: "In the prototype I only reply with canned text. The itinerary I already drafted is on the Plan tab; open a stop there to see the reasoning.",
        proposalId: null, createdAt: new Date().toISOString(),
      }]);
    }, 1600);
  }

  if (showInfo) {
    return (
      <div className="demo-chat">
        <GroupInfo groupName={DEMO_TRIP.name} members={DEMO_MEMBERS} onBack={() => setShowInfo(false)} />
      </div>
    );
  }

  return (
    <div className="demo-chat">
      <ChatHeader
        groupName={DEMO_TRIP.name}
        members={DEMO_MEMBERS}
        onOpenInfo={() => setShowInfo(true)}
        actions={<>
          <span className="chat-connection" data-state="connected">
            <span className="chat-connection-dot" aria-hidden="true" />Demo
          </span>
          <InvitePanel />
        </>}
      />

      <MessageList
        messages={messages}
        members={[...DEMO_MEMBERS, ASSISTANT_TYPING]}
        selfMemberId={DEMO_SELF_MEMBER_ID}
        onRetry={() => {}}
        typingMemberIds={typingMemberIds}
        reactions={reactions}
        onReact={react}
      />

      <details className="signal-panel" open>
        <summary className="signal-panel-head">
          <Search size={14} aria-hidden="true" />
          <span>From this chat the assistant picked up {DEMO_SIGNALS.length} things. Confirm what should shape the plan.</span>
          <ChevronDown className="collapse-chevron" size={16} aria-hidden="true" />
        </summary>
        <ul className="signal-list">
          {DEMO_SIGNALS.map((signal) => <ChatSignalCard key={signal.id} signal={signal} />)}
        </ul>
      </details>

      <Composer onSend={send} />
    </div>
  );
}
