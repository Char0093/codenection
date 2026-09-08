"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageItem } from "@/features/chat/message-item";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
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

export function MessageList({ messages, members, selfMemberId, onRetry, proposalsById, canDecideProposals, activeProposalId, decidingProposalId, onDecision }: {
  messages: readonly ChatEntry[];
  members: readonly JigsawMember[];
  selfMemberId: string | null;
  onRetry: (id: string) => void;
  proposalsById?: Readonly<Record<string, ProposalRecord>>;
  canDecideProposals?: boolean;
  activeProposalId?: string | null;
  decidingProposalId?: string | null;
  onDecision?: (proposalId: string, decision: "accept" | "reject") => void;
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
  }, [messages.length]);

  return <>
    <ul className="chat-message-list" ref={listRef} aria-label="Trip chat messages">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const showHeader = !previous || previous.authorMemberId !== message.authorMemberId || previous.authorKind !== message.authorKind;
        const author = members.find((member) => member.id === message.authorMemberId);
        const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
        return <React.Fragment key={message.id}>
          {newDay && <li className="chat-date-sep"><span>{dayLabel(message.createdAt)}</span></li>}
          <MessageItem message={message} author={author}
            showHeader={showHeader || newDay} groupStart={showHeader || newDay} isSelf={message.authorMemberId === selfMemberId}
            onRetry={() => onRetry(message.id)}
            proposal={message.proposalId ? proposalsById?.[message.proposalId] : undefined}
            canDecideProposals={canDecideProposals} activeProposalId={activeProposalId}
            decidingProposalId={decidingProposalId} onDecision={onDecision} />
        </React.Fragment>;
      })}
    </ul>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </>;
}
