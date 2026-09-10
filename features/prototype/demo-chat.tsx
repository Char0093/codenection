"use client";

import React, { useState } from "react";
import { Search } from "lucide-react";
import { MessageList } from "@/features/chat/message-list";
import { Composer } from "@/features/chat/composer";
import { ChatSignalCard } from "@/features/prototype/chat-signal-card";
import { InvitePanel } from "@/features/prototype/invite-panel";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import { shouldAddressAssistant } from "@/lib/chat/mention";
import {
  DEMO_CHAT_MESSAGES, DEMO_MEMBERS, DEMO_SELF_MEMBER_ID, DEMO_SIGNALS, DEMO_TRIP_ID,
} from "@/lib/prototype/fixtures";

/** Prototype chat: the real MessageList + Composer over seeded messages, plus the assistant's
 *  chat-preference-extraction panel. Sending a message that addresses the assistant appends a
 *  canned reply. Nothing leaves the browser and nothing persists. */
export function DemoChat() {
  const [messages, setMessages] = useState<ChatEntry[]>(() => DEMO_CHAT_MESSAGES.map((m) => ({ ...m })));

  function send(body: string) {
    const now = new Date().toISOString();
    const mine: ChatEntry = {
      id: `local-${Date.now()}`, tripId: DEMO_TRIP_ID, authorMemberId: DEMO_SELF_MEMBER_ID,
      authorKind: "member", body, proposalId: null, createdAt: now,
    };
    setMessages((prev) => [...prev, mine]);
    if (!shouldAddressAssistant(body)) return;
    window.setTimeout(() => {
      setMessages((prev) => [...prev, {
        id: `assist-${Date.now()}`, tripId: DEMO_TRIP_ID, authorMemberId: null, authorKind: "assistant",
        body: "In the prototype I only reply with canned text. The itinerary I already drafted is on the Plan tab; open a stop there to see the reasoning.",
        proposalId: null, createdAt: new Date().toISOString(),
      }]);
    }, 600);
  }

  return (
    <div className="demo-chat">
      <div className="chat-pane-top">
        <span className="chat-pane-member-count">{DEMO_MEMBERS.length} members</span>
        <InvitePanel />
        <span className="chat-connection" data-state="connected">
          <span className="chat-connection-dot" aria-hidden="true" />Demo
        </span>
      </div>

      <MessageList
        messages={messages}
        members={DEMO_MEMBERS}
        selfMemberId={DEMO_SELF_MEMBER_ID}
        onRetry={() => {}}
      />

      <section className="signal-panel" aria-label="What the assistant picked up from chat">
        <p className="signal-panel-head">
          <Search size={14} aria-hidden="true" />
          From this chat the assistant picked up {DEMO_SIGNALS.length} things. Confirm what should shape the plan.
        </p>
        <ul className="signal-list">
          {DEMO_SIGNALS.map((signal) => <ChatSignalCard key={signal.id} signal={signal} />)}
        </ul>
      </section>

      <Composer onSend={send} />
    </div>
  );
}
