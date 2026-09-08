import React from "react";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";

export function PresenceBar({ members, presentMemberIds }: {
  members: readonly JigsawMember[];
  presentMemberIds: readonly string[];
}) {
  const present = members.filter((member) => presentMemberIds.includes(member.id));
  if (present.length === 0) return null;
  return <div className="presence-bar" aria-label="Viewing now">
    {present.map((member) => (
      <span key={member.id} className="presence-avatar-wrap" title={member.displayName}>
        <span className="presence-avatar" style={{ background: member.color }} aria-hidden="true">
          {member.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="presence-online-dot" aria-hidden="true" />
        <span className="sr-only">{member.displayName} online</span>
      </span>
    ))}
  </div>;
}
