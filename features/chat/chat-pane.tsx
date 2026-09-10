"use client";

import React, { useState } from "react";
import { AlertCircle, LoaderCircle, Sparkles } from "lucide-react";
import { useTripChannel } from "@/features/chat/use-trip-channel";
import { PresenceBar } from "@/features/chat/presence-bar";
import { MessageList } from "@/features/chat/message-list";
import { Composer } from "@/features/chat/composer";
import { shouldAddressAssistant } from "@/lib/chat/mention";
import type { Tapback } from "@/features/chat/tapback";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

export function ChatPane({ tripId, selfMemberId, members, proposalsById, canDecideProposals, activeProposalId, decidingProposalId, onDecision }: {
  tripId: string;
  selfMemberId: string | null;
  members: readonly JigsawMember[];
  proposalsById?: Readonly<Record<string, ProposalRecord>>;
  canDecideProposals?: boolean;
  activeProposalId?: string | null;
  decidingProposalId?: string | null;
  onDecision?: (proposalId: string, decision: "accept" | "reject") => void;
}) {
  const { messages, status, presentMemberIds, typingMemberIds, loading, loadError, send, retry, notifyTyping } = useTripChannel(tripId, selfMemberId);
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  // Viewer-local reactions. Not persisted and not shared -- see features/chat/tapback.tsx.
  const [reactions, setReactions] = useState<Record<string, Tapback>>({});

  function react(messageId: string, tapback: Tapback | null) {
    setReactions((existing) => {
      if (!tapback) {
        const { [messageId]: _removed, ...rest } = existing;
        return rest;
      }
      return { ...existing, [messageId]: tapback };
    });
  }

  async function handleSend(body: string) {
    await send(body);
    if (!shouldAddressAssistant(body)) return;
    setAssistantThinking(true);
    setAssistantError(null);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/chat/assistant`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: body }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "The assistant could not answer that. Please try again.");
      }
    } catch (cause) {
      setAssistantError(cause instanceof Error ? cause.message : "The assistant could not answer that. Please try again.");
    } finally {
      setAssistantThinking(false);
    }
  }

  const connectionLabel = status === "connected" ? "Live" : status === "polling" ? "Reconnecting…" : status === "disconnected" ? "Offline" : "Connecting…";

  return <div className="chat-pane">
    <div className="chat-pane-top">
      <div className="chat-pane-members">
        <PresenceBar members={members} presentMemberIds={presentMemberIds} />
        <span className="chat-pane-member-count">{members.length} member{members.length === 1 ? "" : "s"}</span>
      </div>
      <span className="chat-connection" data-state={status}>
        <span className="chat-connection-dot" aria-hidden="true" />
        {connectionLabel}
      </span>
    </div>
    {loading ? (
      <p className="inline-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading chat...</p>
    ) : loadError ? (
      <p className="error-notice" role="alert"><AlertCircle aria-hidden="true" /><span>{loadError}</span></p>
    ) : (
      <MessageList messages={messages} members={members} selfMemberId={selfMemberId} onRetry={retry}
        proposalsById={proposalsById} canDecideProposals={canDecideProposals}
        activeProposalId={activeProposalId} decidingProposalId={decidingProposalId} onDecision={onDecision}
        typingMemberIds={typingMemberIds} reactions={reactions} onReact={react} />
    )}
    {assistantThinking && <p className="inline-notice chat-assistant-note" role="status"><Sparkles size={14} aria-hidden="true" />Assistant is thinking...</p>}
    {assistantError && <p className="error-notice chat-assistant-note" role="alert"><AlertCircle aria-hidden="true" /><span>{assistantError}</span></p>}
    <Composer onSend={(body) => void handleSend(body)} disabled={!selfMemberId} onTyping={notifyTyping} />
  </div>;
}
