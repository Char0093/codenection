"use client";

import React, { useState } from "react";
import { AlertCircle, LoaderCircle, Sparkles, UserPlus } from "lucide-react";
import { useTripChannel } from "@/features/chat/use-trip-channel";
import { ChatHeader } from "@/features/chat/chat-header";
import { GroupInfo } from "@/features/chat/group-info";
import { MessageList } from "@/features/chat/message-list";
import { Composer } from "@/features/chat/composer";
import { shouldAddressAssistant } from "@/lib/chat/mention";
import type { Tapback } from "@/features/chat/tapback";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

export function ChatPane({ tripId, groupName = "Trip chat", selfMemberId, members, proposalsById, canDecideProposals, activeProposalId, decidingProposalId, onDecision }: {
  tripId: string;
  /** Group title shown in the header; the header opens the group-info view. */
  groupName?: string;
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
  // Pressing the header swaps the thread for the group-info view (wireframe panels 2-3).
  const [showInfo, setShowInfo] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / denied) -- leave the label unchanged.
    }
  }

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

  if (showInfo) {
    return <div className="chat-pane">
      <GroupInfo groupName={groupName} members={members} onBack={() => setShowInfo(false)} />
    </div>;
  }

  return <div className="chat-pane">
    <ChatHeader
      groupName={groupName}
      members={members}
      presentMemberIds={presentMemberIds}
      onOpenInfo={() => setShowInfo(true)}
      actions={<>
        <span className="chat-connection" data-state={status}>
          <span className="chat-connection-dot" aria-hidden="true" />
          {connectionLabel}
        </span>
        <button type="button" className="chat-invite-button" onClick={copyInvite}>
          <UserPlus size={14} aria-hidden="true" />
          <span>{inviteCopied ? "Link copied" : "Invite"}</span>
        </button>
      </>}
    />
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
