"use client";

import { Map as MapIcon, MessageSquare, PanelsTopLeft } from "lucide-react";
import React, { useState } from "react";
import type { TimelineBlock } from "@/lib/domain/jigsaw";
import { JigsawPanel, type JigsawMember } from "@/features/timeline/jigsaw-panel";

export type WorkspaceShellProps = {
  tripName: string;
  members: readonly JigsawMember[];
  blocks: readonly TimelineBlock[];
  /** The 3D spatial map. Injected so the shell stays renderable without a Mapbox token. */
  mapSlot?: React.ReactNode;
  /** The realtime group chat. */
  chatSlot?: React.ReactNode;
  onBlocksChange?: (blocks: TimelineBlock[]) => void;
};

/**
 * The dual-layer contextual surface: a 3D spatial map on top, the collaborative chatroom and
 * action sheet below. Pre-trip mode swaps the whole surface for the full-screen Timeline Jigsaw,
 * because bargaining over blocks needs the horizontal room.
 */
export function WorkspaceShell({
  tripName,
  members,
  blocks,
  mapSlot,
  chatSlot,
  onBlocksChange,
}: WorkspaceShellProps) {
  const [jigsawOpen, setJigsawOpen] = useState(false);

  return (
    <div className="workspace">
      <header className="workspace-bar">
        <h1>{tripName}</h1>
        <div className="workspace-presence">
          {members.map((member) => (
            <span key={member.id} className="workspace-avatar" style={{ background: member.color }} title={member.displayName}>
              {member.displayName.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="workspace-toggle"
          onClick={() => setJigsawOpen((open) => !open)}
          aria-pressed={jigsawOpen}
        >
          <PanelsTopLeft size={14} aria-hidden />
          {jigsawOpen ? "Close jigsaw" : "Timeline jigsaw"}
        </button>
      </header>

      {jigsawOpen ? (
        <div className="workspace-jigsaw" role="region" aria-label="Pre-trip timeline jigsaw">
          <JigsawPanel blocks={blocks} members={members} onChange={onBlocksChange} />
        </div>
      ) : (
        <div className="workspace-panes">
          <section className="workspace-map" aria-label="Spatial map">
            {mapSlot ?? (
              <div className="workspace-placeholder">
                <MapIcon size={20} aria-hidden />
                <p>3D map loads once a Mapbox token is configured.</p>
              </div>
            )}
          </section>
          <section className="workspace-chat" aria-label="Group chat">
            {chatSlot ?? (
              <div className="workspace-placeholder">
                <MessageSquare size={20} aria-hidden />
                <p>Group chat appears here.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
