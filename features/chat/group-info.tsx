"use client";

import React, { useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Search, Share2, UserPlus, Users } from "lucide-react";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";

/** Placeholder settings rows -- the "Title / >" list from the wireframe (panel 3). Wired to
 *  nothing yet; this view is layout only. */
const SETTINGS_ROWS = [
  "Group name & photo",
  "Notifications",
  "Media, links & docs",
  "Shared trip plan",
  "Privacy & safety",
  "Report group",
  "Leave group",
] as const;

/**
 * The group-information view reached by pressing the chat header. Two tabs:
 *  - Members: an "Add members" affordance followed by every member.
 *  - Setting: a plain titled list with disclosure chevrons.
 * Rendered in place of the message list; `onBack` returns to the thread.
 */
export function GroupInfo({ groupName, members, onBack }: {
  groupName: string;
  members: readonly JigsawMember[];
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"members" | "settings">("members");

  return (
    <div className="group-info">
      <div className="group-info-top">
        <button type="button" className="group-info-back" onClick={onBack} aria-label="Back to chat">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="group-info-head">
        <span className="group-info-avatar" aria-hidden="true"><Users size={28} /></span>
        <h2 className="group-info-name">{groupName}</h2>
        <div className="group-info-quick">
          <button type="button" className="group-info-quick-item">
            <Bell size={18} aria-hidden="true" /><span>Notifications</span>
          </button>
          <button type="button" className="group-info-quick-item">
            <Search size={18} aria-hidden="true" /><span>Search</span>
          </button>
          <button type="button" className="group-info-quick-item">
            <Share2 size={18} aria-hidden="true" /><span>Share</span>
          </button>
        </div>
      </div>

      <div className="group-info-tabs" role="tablist" aria-label="Group information">
        <button type="button" role="tab" id="group-info-tab-members" aria-selected={tab === "members"}
          className="group-info-tab" data-active={tab === "members"} onClick={() => setTab("members")}>
          Members
        </button>
        <button type="button" role="tab" id="group-info-tab-settings" aria-selected={tab === "settings"}
          className="group-info-tab" data-active={tab === "settings"} onClick={() => setTab("settings")}>
          Setting
        </button>
      </div>

      {tab === "members" ? (
        <ul className="group-info-list" role="tabpanel" aria-labelledby="group-info-tab-members">
          <li className="group-info-row group-info-row-action">
            <span className="group-info-row-icon" aria-hidden="true"><UserPlus size={18} /></span>
            <span className="group-info-row-label">Add members</span>
          </li>
          {members.map((member) => (
            <li key={member.id} className="group-info-row">
              <span className="group-info-member-avatar" style={{ background: member.color }} aria-hidden="true">
                {member.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="group-info-row-label">{member.displayName}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="group-info-list" role="tabpanel" aria-labelledby="group-info-tab-settings">
          {SETTINGS_ROWS.map((title) => (
            <li key={title} className="group-info-row group-info-row-link">
              <span className="group-info-row-label">{title}</span>
              <ChevronRight size={16} className="group-info-row-chevron" aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
