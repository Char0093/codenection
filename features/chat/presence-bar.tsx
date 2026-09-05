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
      <span key={member.id} className="presence-avatar" style={{ background: member.color }} title={member.displayName}>
        {member.displayName.slice(0, 1).toUpperCase()}
      </span>
    ))}
  </div>;
}
