"use client";

import { Map as MapIcon, MessageSquare, PanelsTopLeft } from "lucide-react";
import React, { useEffect, useState } from "react";
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

/** Below this width the two panes collapse into tabs -- there is no room to show both at once. */
const TABLET_BREAKPOINT_QUERY = "(max-width: 768px)";

function usePanesCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(TABLET_BREAKPOINT_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(TABLET_BREAKPOINT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setCollapsed(event.matches);
    setCollapsed(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return collapsed;
}

/**
 * The dual-layer contextual surface: a 3D spatial map on top, the collaborative chatroom and
 * action sheet below. Pre-trip mode swaps the whole surface for the full-screen Timeline Jigsaw,
 * because bargaining over blocks needs the horizontal room. Below the tablet breakpoint the two
 * panes collapse into tabs (Task 3.5) rather than squeezing both into half-height strips.
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
  const [activeTab, setActiveTab] = useState<"map" | "chat">("map");
  const collapsed = usePanesCollapsed();

  const mapPane = <section className="workspace-map" aria-label="Spatial map">
    {mapSlot ?? (
      <div className="workspace-placeholder">
        <MapIcon size={20} aria-hidden />
        <p>3D map loads once a Mapbox token is configured.</p>
      </div>
    )}
  </section>;
  const chatPane = <section className="workspace-chat" aria-label="Group chat">
    {chatSlot ?? (
      <div className="workspace-placeholder">
        <MessageSquare size={20} aria-hidden />
        <p>Group chat appears here.</p>
      </div>
    )}
  </section>;

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
      ) : collapsed ? (
        <div className="workspace-collapsed">
          <div className="view-tabs workspace-pane-tabs" role="tablist" aria-label="Workspace pane">
            {(["map", "chat"] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}>
                {tab === "map" ? <MapIcon size={14} aria-hidden /> : <MessageSquare size={14} aria-hidden />}
                {tab === "map" ? "Map" : "Chat"}
              </button>
            ))}
          </div>
          {activeTab === "map" ? mapPane : chatPane}
        </div>
      ) : (
        <div className="workspace-panes">
          {mapPane}
          {chatPane}
        </div>
      )}
    </div>
  );
}
