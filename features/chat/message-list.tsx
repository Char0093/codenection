"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageItem } from "@/features/chat/message-item";
import { TypingIndicator } from "@/features/chat/typing-indicator";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { Tapback } from "@/features/chat/tapback";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

function dayKey(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toDateString();
}

/** "Today" / "Yesterday" / a full weekday date -- the divider between message groups from
 * different calendar days, the one piece of orientation info no single message carries. */
function dayLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (parsed.toDateString() === today.toDateString()) return "Today";
  if (parsed.toDateString() === yesterday.toDateString()) return "Yesterday";
  return parsed.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function MessageList({ messages, members, selfMemberId, onRetry, proposalsById, canDecideProposals, activeProposalId, decidingProposalId, onDecision, typingMemberIds = [], reactions, onReact }: {
  messages: readonly ChatEntry[];
  members: readonly JigsawMember[];
  selfMemberId: string | null;
  onRetry: (id: string) => void;
  proposalsById?: Readonly<Record<string, ProposalRecord>>;
  canDecideProposals?: boolean;
  activeProposalId?: string | null;
  decidingProposalId?: string | null;
  onDecision?: (proposalId: string, decision: "accept" | "reject") => void;
  typingMemberIds?: readonly string[];
  /** messageId -> the reaction this viewer applied. See features/chat/tapback.tsx on storage. */
  reactions?: Readonly<Record<string, Tapback>>;
  onReact?: (messageId: string, tapback: Tapback | null) => void;
}) {
  const [announcement, setAnnouncement] = useState("");
  const seen = useRef(new Set<string>());
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.pending || seen.current.has(latest.id)) return;
    seen.current.add(latest.id);
    const name = latest.authorKind === "assistant" ? "Assistant"
      : latest.authorKind === "system" ? "System"
      : members.find((member) => member.id === latest.authorMemberId)?.displayName ?? "Member";
    setAnnouncement(name + " says " + latest.body);
  }, [messages, members]);

  useEffect(() => {
    const list = listRef.current;
    if (list && typeof list.scrollTo === "function") list.scrollTo({ top: list.scrollHeight });
  }, [messages.length, typingMemberIds.length]);

  // "Delivered" belongs under the newest outgoing message only, and collapses off the previous
  // one as soon as a newer outgoing message lands -- the same slot iMessage uses.
  const lastDeliveredId = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.authorMemberId !== selfMemberId) continue;
      if (message.pending || message.failed) return null;
      return message.id;
    }
    return null;
  })();

  return <>
    <ul className="chat-message-list" ref={listRef} aria-label="Trip chat messages">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const next = messages[index + 1];
        const showHeader = !previous || previous.authorMemberId !== message.authorMemberId || previous.authorKind !== message.authorKind;
        // Last message of a sender's run -- the row that carries the avatar in the side gutter.
        const runEnd = !next || next.authorMemberId !== message.authorMemberId || next.authorKind !== message.authorKind;
        const author = members.find((member) => member.id === message.authorMemberId);
        const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
        return <React.Fragment key={message.id}>
          {newDay && <li className="chat-date-sep"><span>{dayLabel(message.createdAt)}</span></li>}
          <MessageItem message={message} author={author}
            showName={showHeader || newDay} groupStart={showHeader || newDay} showAvatar={runEnd}
            isSelf={message.authorMemberId === selfMemberId}
            onRetry={() => onRetry(message.id)}
            proposal={message.proposalId ? proposalsById?.[message.proposalId] : undefined}
            canDecideProposals={canDecideProposals} activeProposalId={activeProposalId}
            decidingProposalId={decidingProposalId} onDecision={onDecision}
            delivered={message.id === lastDeliveredId}
            reaction={reactions?.[message.id] ?? null} onReact={onReact} />
        </React.Fragment>;
      })}
      <TypingIndicator members={members} typingMemberIds={typingMemberIds} />
    </ul>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </>;
}
