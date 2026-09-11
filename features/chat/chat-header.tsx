"use client";

import React from "react";
import { Info } from "lucide-react";
import { PresenceBar } from "@/features/chat/presence-bar";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";

/**
 * The chat thread's top bar. The member count + group title together are a single button that
 * opens the group-info view (see features/chat/group-info.tsx); the trailing `actions` slot
 * carries the connection pill and the Invite control, right-aligned.
 */
export function ChatHeader({ groupName, members, presentMemberIds = [], onOpenInfo, actions }: {
  groupName: string;
  members: readonly JigsawMember[];
  presentMemberIds?: readonly string[];
  onOpenInfo: () => void;
  actions?: React.ReactNode;
}) {
  const count = members.length;
  return (
    <div className="chat-pane-top">
      <button type="button" className="chat-pane-heading" onClick={onOpenInfo}
        aria-label={`Open group info for ${groupName}`}>
        <PresenceBar members={members} presentMemberIds={presentMemberIds} />
        <span className="chat-pane-member-count">{count} member{count === 1 ? "" : "s"}</span>
        <span className="chat-pane-title">{groupName}</span>
        <Info size={14} className="chat-pane-heading-hint" aria-hidden="true" />
      </button>
      {actions ? <div className="chat-pane-top-actions">{actions}</div> : null}
    </div>
  );
}
