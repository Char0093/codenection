"use client";

import React, { useState } from "react";
import { MessageList } from "@/features/chat/message-list";
import { Composer } from "@/features/chat/composer";
import { ChatHeader } from "@/features/chat/chat-header";
import { GroupInfo } from "@/features/chat/group-info";
import { InvitePanel } from "@/features/prototype/invite-panel";
import type { Tapback } from "@/features/chat/tapback";
import { shouldAddressAssistant } from "@/lib/chat/mention";
import { useDemoTripState } from "@/features/prototype/demo-trip-state";
import { DEMO_MEMBERS, DEMO_SELF_MEMBER_ID, DEMO_TRIP } from "@/lib/prototype/fixtures";

/**
 * The assistant is not a trip member, so it has no row in DEMO_MEMBERS. This pseudo-member
 * exists purely so the typing indicator can name it; no message is ever authored against this
 * id, and it is not counted in the member total shown in the header.
 */
const ASSISTANT_TYPING = { id: "demo-assistant-typing", displayName: "Assistant", color: "#af52de" };
const DEMO_ASSISTANT_TYPING_ID = ASSISTANT_TYPING.id;

/** Prototype chat: the real MessageList + Composer over seeded messages. Sending a message
 *  that addresses the assistant appends a canned reply. Nothing leaves the browser and nothing
 *  persists. Discovery signals and safety constraints heard in this chat now surface on the
 *  Decisions page instead of inline here. */
export function DemoChat() {
  // Shared with every other prototype page for this trip (see DemoTripStateProvider) -- a
  // message posted from the Timeline's Save button shows up here without either page needing
  // to know about the other.
  const { messages, postMessage } = useDemoTripState();
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
    postMessage(body);
    if (!shouldAddressAssistant(body)) return;
    // Show the assistant composing while its canned reply is pending -- the same dots the
    // live pane renders from a real broadcast, driven here by a timer.
    setTypingMemberIds([DEMO_ASSISTANT_TYPING_ID]);
    window.setTimeout(() => {
      setTypingMemberIds([]);
      postMessage(
        "In the prototype I only reply with canned text. The itinerary I already drafted is on the Plan tab; open a stop there to see the reasoning.",
        "assistant",
      );
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

      <Composer onSend={send} />
    </div>
  );
}
