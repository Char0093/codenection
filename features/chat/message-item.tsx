import React from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { AssistantProposalCard } from "@/features/chat/assistant-proposal-card";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function MessageItem({ message, author, showHeader, isSelf, onRetry, proposal, canDecideProposals, activeProposalId, decidingProposalId, onDecision }: {
  message: ChatEntry;
  author?: JigsawMember;
  showHeader: boolean;
  isSelf: boolean;
  onRetry?: () => void;
  proposal?: ProposalRecord;
  canDecideProposals?: boolean;
  activeProposalId?: string | null;
  decidingProposalId?: string | null;
  onDecision?: (proposalId: string, decision: "accept" | "reject") => void;
}) {
  const displayName = message.authorKind === "assistant" ? "Assistant" : message.authorKind === "system" ? "System" : author?.displayName ?? "Member";

  return <li className="chat-message" data-author-kind={message.authorKind} data-self={isSelf ? "true" : undefined}>
    {showHeader && <div className="chat-message-header">
      <span className="chat-message-avatar" style={{ background: message.authorKind === "member" ? author?.color : undefined }}>
        {message.authorKind === "assistant" ? <Sparkles size={12} aria-hidden /> : displayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="chat-message-name">{displayName}</span>
      <span className="chat-message-time">{formatTime(message.createdAt)}</span>
    </div>}
    <p className="chat-message-body">{message.body}</p>
    {message.proposalId && <AssistantProposalCard proposal={proposal}
      active={proposal !== undefined && proposal.id === activeProposalId}
      canDecide={canDecideProposals} busy={decidingProposalId === message.proposalId}
      onDecision={(decision) => onDecision?.(message.proposalId as string, decision)} />}
    {message.pending && <span className="chat-message-status" role="status">Sending...</span>}
    {message.failed && <span className="chat-message-status chat-message-failed" role="alert">
      Not sent.
      <button type="button" onClick={onRetry}><RotateCcw size={12} aria-hidden />Retry</button>
    </span>}
  </li>;
}
