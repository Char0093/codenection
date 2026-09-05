"use client";

import { Bus, GripVertical, Landmark, Lock, Scissors, ShoppingBag, Trees, TriangleAlert, UtensilsCrossed } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  SLOT_MINUTES,
  type TimelineBlock,
  type TrilemmaOption,
  blockTexture,
  detectConflicts,
  evaluateTeam,
  isRigidAnchor,
  magneticSnap,
  shouldSplitCut,
  snapToGrid,
  trilemmaOptions,
} from "@/lib/domain/jigsaw";

export type JigsawMember = { id: string; displayName: string; color: string };

export type JigsawPanelProps = {
  blocks: readonly TimelineBlock[];
  members: readonly JigsawMember[];
  /** Visible timeline range in minutes from local midnight. */
  dayStartMinute?: number;
  dayEndMinute?: number;
  /** Pixels per minute. Drives block height, so a longer stay is a taller card. */
  scale?: number;
  onChange?: (blocks: TimelineBlock[]) => void;
  onResolve?: (option: TrilemmaOption) => void;
};

const CATEGORY_ICON = {
  culture: Landmark,
  food: UtensilsCrossed,
  nature: Trees,
  shopping: ShoppingBag,
  transit: Bus,
} as const;

function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const rest = minute % 60;
  return String(hour).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

export function JigsawPanel({
  blocks,
  members,
  dayStartMinute = 8 * 60,
  dayEndMinute = 23 * 60,
  scale = 1.6,
  onChange,
  onResolve,
}: JigsawPanelProps) {
  const [draft, setDraft] = useState<readonly TimelineBlock[]>(blocks);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragState = useRef<{ pointerId: number; originY: number; originStart: number } | null>(null);

  const memberIds = useMemo(() => members.map((member) => member.id), [members]);
  const placed = useMemo(() => draft.filter((entry) => entry.startMinute !== null), [draft]);
  const pool = useMemo(() => draft.filter((entry) => entry.startMinute === null), [draft]);
  const conflicts = useMemo(() => detectConflicts(placed), [placed]);
  const outcome = useMemo(() => evaluateTeam(placed, draft, memberIds), [placed, draft, memberIds]);
  const splitAdvised = useMemo(() => shouldSplitCut(outcome), [outcome]);

  const commit = useCallback(
    (next: TimelineBlock[]) => {
      setDraft(next);
      onChange?.(next);
    },
    [onChange],
  );

  const moveBlock = useCallback(
    (id: string, rawStartMinute: number) => {
      const target = draft.find((entry) => entry.id === id);
      if (!target || isRigidAnchor(target)) return;
      const anchors = draft.filter((entry) => entry.id !== id && entry.startMinute !== null);
      const startMinute = magneticSnap(rawStartMinute, target, anchors);
      commit(draft.map((entry) => (entry.id === id ? { ...entry, startMinute } : entry)));
    },
    [draft, commit],
  );

  const handlePointerDown = (block: TimelineBlock) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (isRigidAnchor(block) || block.startMinute === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { pointerId: event.pointerId, originY: event.clientY, originStart: block.startMinute };
    setDragId(block.id);
  };

  const handlePointerMove = (block: TimelineBlock) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId || dragId !== block.id) return;
    const deltaMinutes = (event.clientY - state.originY) / scale;
    moveBlock(block.id, snapToGrid(state.originStart + deltaMinutes));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      setDragId(null);
    }
  };

  // Keyboard drag: the timeline must be usable without a pointer. Up/Down match the vertical
  // layout; Left/Right are kept working too since "earlier/later" reads fine either way.
  const handleKeyDown = (block: TimelineBlock) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (block.startMinute === null || isRigidAnchor(block)) return;
    const step = event.shiftKey ? SLOT_MINUTES * 2 : SLOT_MINUTES;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveBlock(block.id, block.startMinute - step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveBlock(block.id, block.startMinute + step);
    }
  };

  const span = Math.max(SLOT_MINUTES, dayEndMinute - dayStartMinute);
  const ticks = [];
  for (let minute = dayStartMinute; minute <= dayEndMinute; minute += 60) ticks.push(minute);

  const conflictIds = new Set(conflicts.flatMap((conflict) => [conflict.firstId, conflict.secondId]));

  return (
    <section className="jigsaw" aria-label="Timeline jigsaw">
      {conflicts.length > 0 ? (
        <div className="jigsaw-alert" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span>
            {conflicts.length} overlapping {conflicts.length === 1 ? "block" : "blocks"} on the timeline.
          </span>
          <div className="jigsaw-trilemma">
            {trilemmaOptions(conflicts[0], draft).map((option) => (
              <button key={option.kind} type="button" onClick={() => onResolve?.(option)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="jigsaw-scroll">
        <div className="jigsaw-body" style={{ height: span * scale }}>
          <div className="jigsaw-ruler-v">
            {ticks.map((minute) => (
              <span key={minute} className="jigsaw-tick-v" style={{ top: (minute - dayStartMinute) * scale }}>
                {formatMinute(minute)}
              </span>
            ))}
          </div>

          <div
            className="jigsaw-track-v"
            data-testid="jigsaw-track"
            style={{
              backgroundImage: "linear-gradient(to bottom, var(--line), var(--line) 1px, transparent 1px, transparent 100%)",
              backgroundSize: "100% " + 60 * scale + "px",
            }}
          >
            {placed.map((block) => {
              const texture = blockTexture(block, memberIds);
              const anchored = isRigidAnchor(block);
              const start = block.startMinute as number;
              const Icon = CATEGORY_ICON[block.category];
              return (
                <button
                  key={block.id}
                  type="button"
                  className="jigsaw-block-v"
                  data-texture={texture}
                  data-anchored={anchored ? "true" : undefined}
                  data-conflict={conflictIds.has(block.id) ? "true" : undefined}
                  data-dragging={dragId === block.id ? "true" : undefined}
                  style={{ top: (start - dayStartMinute) * scale, height: block.durationMinutes * scale }}
                  aria-label={
                    block.title +
                    ", " +
                    formatMinute(start) +
                    " for " +
                    block.durationMinutes +
                    " minutes" +
                    (anchored ? ", locked anchor" : "")
                  }
                  aria-describedby={conflictIds.has(block.id) ? "jigsaw-conflict-hint" : undefined}
                  disabled={anchored}
                  onPointerDown={handlePointerDown(block)}
                  onPointerMove={handlePointerMove(block)}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onKeyDown={handleKeyDown(block)}
                >
                  <span className="jigsaw-block-handle">
                    {anchored ? <Lock size={13} aria-hidden /> : <GripVertical size={14} aria-hidden />}
                  </span>
                  <span className="jigsaw-cat-icon">
                    <Icon size={13} aria-hidden />
                  </span>
                  <span className="jigsaw-block-text">
                    <span className="jigsaw-block-title">{block.title}</span>
                    <span className="jigsaw-block-time">{formatMinute(start)} &middot; {block.durationMinutes} min</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p id="jigsaw-conflict-hint" hidden>
        This block overlaps another. Use the resolution options above.
      </p>

      <div className="jigsaw-meters" aria-label="Team satisfaction">
        {outcome.members.map((member) => {
          const profile = members.find((entry) => entry.id === member.memberId);
          return (
            <div key={member.memberId} className="jigsaw-meter">
              <span className="jigsaw-meter-name">{profile?.displayName ?? member.memberId}</span>
              <span
                className="jigsaw-meter-bar"
                role="meter"
                aria-valuenow={Math.round(member.ratio * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={(profile?.displayName ?? member.memberId) + " satisfaction"}
              >
                <span
                  className="jigsaw-meter-fill"
                  data-low={member.ratio < 0.7 ? "true" : undefined}
                  style={{ width: Math.round(member.ratio * 100) + "%", background: profile?.color }}
                />
              </span>
              <span className="jigsaw-meter-value">{Math.round(member.ratio * 100)}%</span>
            </div>
          );
        })}
      </div>

      {splitAdvised ? (
        <p className="jigsaw-split" role="status">
          <Scissors size={14} aria-hidden /> The group is too divided to share one trajectory. A tactical split
          is suggested.
        </p>
      ) : null}

      {pool.length > 0 ? (
        <div className="jigsaw-pool" aria-label="Unaccommodated wishes">
          <h3>Unplaced wishes</h3>
          <ul>
            {pool.map((block) => (
              <li key={block.id}>{block.title}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
