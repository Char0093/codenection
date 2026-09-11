"use client";

import React, { useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { AssistantProposalCard } from "@/features/chat/assistant-proposal-card";
import { TapbackChip, TapbackStrip, type Tapback } from "@/features/chat/tapback";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Long-press threshold for opening the tapback strip (ios-chat-design.md §4: ~500ms). */
const LONG_PRESS_MS = 500;

export function MessageItem({ message, author, showName, groupStart, showAvatar, isSelf, onRetry, proposal, canDecideProposals, activeProposalId, decidingProposalId, onDecision, delivered, reaction, onReact }: {
  message: ChatEntry;
  author?: JigsawMember;
  /** First message of a sender's run -- render the name label above the bubble (others only). */
  showName: boolean;
  groupStart: boolean;
  /** Last message of a sender's run -- render the sender avatar in the side gutter. */
  showAvatar: boolean;
  isSelf: boolean;
  onRetry?: () => void;
  proposal?: ProposalRecord;
  canDecideProposals?: boolean;
  activeProposalId?: string | null;
  decidingProposalId?: string | null;
  onDecision?: (proposalId: string, decision: "accept" | "reject") => void;
  /** True only for the newest successfully-sent outgoing message. */
  delivered?: boolean;
  reaction?: Tapback | null;
  onReact?: (messageId: string, tapback: Tapback | null) => void;
}) {
  const displayName = message.authorKind === "assistant" ? "Assistant" : message.authorKind === "system" ? "System" : author?.displayName ?? "Member";
  const [stripOpen, setStripOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Reacting is only offered where a handler exists, and never on system notices.
  const canReact = Boolean(onReact) && message.authorKind !== "system" && !message.pending && !message.failed;

  function cancelPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }
  function startPress() {
    if (!canReact) return;
    longPressFired.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setStripOpen(true);
    }, LONG_PRESS_MS);
  }
  function pick(tapback: Tapback) {
    // Tapping the active reaction clears it, the way iMessage toggles a tapback off.
    onReact?.(message.id, reaction === tapback ? null : tapback);
    setStripOpen(false);
  }

  return <li className="chat-message" data-author-kind={message.authorKind} data-self={isSelf ? "true" : "false"}
    data-group-start={groupStart ? "true" : "false"} data-pending={message.pending ? "true" : "false"}>
    {/* Avatar sits in a fixed-width gutter beside the bubble column -- left for incoming,
        right for outgoing (row-reverse in CSS). The gutter stays reserved on every row so
        stacked bubbles in a run keep their left/right edge; only the run's last row fills it. */}
    <div className="chat-message-row">
      <span className="chat-message-gutter" aria-hidden={showAvatar ? undefined : "true"}>
        {showAvatar && message.authorKind !== "system" && (
          <span className="chat-message-avatar" style={{ background: message.authorKind === "member" ? author?.color : undefined }}>
            {message.authorKind === "assistant" ? <Sparkles size={12} aria-hidden /> : displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="chat-message-col">
        {showName && message.authorKind !== "system" && (
          <span className="chat-message-name">{displayName}</span>
        )}
        <div className="chat-bubble-wrap">
          {stripOpen && <TapbackStrip current={reaction ?? null} onPick={pick} onDismiss={() => setStripOpen(false)} />}
          <p className="chat-message-body"
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onContextMenu={(event) => { if (canReact) { event.preventDefault(); setStripOpen(true); } }}>
            <span>{message.body}</span>
            <span className="chat-message-time-inline">{formatTime(message.createdAt)}</span>
          </p>
          {reaction && <TapbackChip tapback={reaction} />}
          {canReact && (
            // Keyboard and assistive-tech route to the same strip: a long press is not reachable
            // without a pointer, so the affordance needs a real focusable control of its own.
            <button type="button" className="tapback-open" aria-haspopup="true" aria-expanded={stripOpen}
              onClick={() => setStripOpen((open) => !open)}>
              <span className="sr-only">React to message from {displayName}</span>
              <span aria-hidden="true">+</span>
            </button>
          )}
        </div>
        {message.proposalId && <AssistantProposalCard proposal={proposal}
          active={proposal !== undefined && proposal.id === activeProposalId}
          canDecide={canDecideProposals} busy={decidingProposalId === message.proposalId}
          onDecision={(decision) => onDecision?.(message.proposalId as string, decision)} />}
        {message.pending && <span className="chat-message-status" role="status">Sending...</span>}
        {delivered && !message.pending && !message.failed && <span className="chat-message-status chat-message-delivered">Delivered</span>}
        {message.failed && <span className="chat-message-status chat-message-failed" role="alert">
          Not sent.
          <button type="button" onClick={onRetry}><RotateCcw size={12} aria-hidden />Retry</button>
        </span>}
      </div>
    </div>
  </li>;
}
