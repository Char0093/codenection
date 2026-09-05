"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageItem } from "@/features/chat/message-item";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

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
        return <MessageItem key={message.id} message={message} author={author}
          showHeader={showHeader} isSelf={message.authorMemberId === selfMemberId}
          onRetry={() => onRetry(message.id)}
          proposal={message.proposalId ? proposalsById?.[message.proposalId] : undefined}
          canDecideProposals={canDecideProposals} activeProposalId={activeProposalId}
          decidingProposalId={decidingProposalId} onDecision={onDecision} />;
      })}
    </ul>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </>;
}
