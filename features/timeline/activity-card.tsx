"use client";

import React, { useRef, useState } from "react";
import { AlertTriangle, GripVertical, LoaderCircle, Lock, LockOpen } from "lucide-react";
import {
  MIN_DURATION_MINUTES,
  MOVE_SNAP_MINUTES,
  RESIZE_SNAP_MINUTES,
  clampDuration,
  clampStart,
  minutesToPixels,
  minutesToTime,
  snapTo,
  timeToMinutes,
} from "@/features/timeline/calendar-geometry";
import type { DragItem } from "@/features/timeline/use-drag-commit";

type DragMode = "move" | "resize-top" | "resize-bottom";
type PointerState = { pointerId: number; mode: DragMode; originY: number; originStartMinute: number; originDurationMinutes: number; originDate: string };

function findDateUnderPointer(clientX: number, clientY: number): string | null {
  // Optional chaining: real browsers support this, jsdom (component tests) does not -- falling
  // back to null (the caller keeps the drag's origin day) rather than crashing the drag.
  const element = document.elementFromPoint?.(clientX, clientY);
  const dayElement = element?.closest<HTMLElement>("[data-cal-date]");
  return dayElement?.dataset.calDate ?? null;
}

export function ActivityCard({ item, conflicted, pxPerMinute, onMove, onResize, onUnlock, onUnschedule, announce }: {
  item: DragItem;
  conflicted: boolean;
  pxPerMinute: number;
  onMove: (newDate: string, newStartTime: string) => void;
  onResize: (newStartTime: string, durationMinutes: number) => void;
  onUnlock: () => void;
  /** Only pool-scheduled blocks can go back to the pool; a Gemini block has no catalog row. */
  onUnschedule: () => void;
  announce: (message: string) => void;
}) {
  const startMinute = timeToMinutes(item.localStartTime);
  const endMinute = timeToMinutes(item.localEndTime);
  const durationMinutes = Math.max(MIN_DURATION_MINUTES, endMinute - startMinute);
  const locked = item.fixedCommitment;
  const dragState = useRef<PointerState | null>(null);
  // Live drag/resize preview, local only -- pointermove updates this and nothing else. The network
  // commit fires exactly once, on pointerup, with the final value. Committing on every pointermove
  // would fire dozens of overlapping requests per gesture (a real bug this replaced: each one racing
  // the next, several landing as stale-revision conflicts, making a single drag look like it hangs).
  const [preview, setPreview] = useState<{ date: string; startMinute: number; durationMinutes: number } | null>(null);
  // Mirrors `preview` for synchronous reads at pointerup. Committing there must read the latest
  // drag value directly rather than from inside a setState updater (calling the onMove/onResize
  // callback -- which updates the parent -- from inside a setPreview updater function violates
  // React's rule that updater functions must be pure, and triggers a "cannot update a component
  // while rendering a different component" warning).
  const previewRef = useRef<{ date: string; startMinute: number; durationMinutes: number } | null>(null);

  const displayStart = preview?.startMinute ?? startMinute;
  const displayDuration = preview?.durationMinutes ?? durationMinutes;

  function describe(nextStart: number, nextDuration: number): string {
    const end = minutesToTime(nextStart + nextDuration);
    return `${item.title} now ${minutesToTime(nextStart)} to ${end}, ${nextDuration} minutes.`;
  }

  function updatePreview(next: { date: string; startMinute: number; durationMinutes: number } | null) {
    previewRef.current = next;
    setPreview(next);
  }

  function handlePointerDown(mode: DragMode) {
    return (event: React.PointerEvent<HTMLElement>) => {
      if (locked || item.pending) return;
      event.preventDefault();
      event.stopPropagation();
      // Optional chaining: real browsers implement this so a drag isn't interrupted by whatever
      // the pointer visually passes over, but jsdom (used in component tests) does not -- the
      // handlers below tolerate its absence since tests dispatch events directly on this element.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragState.current = { pointerId: event.pointerId, mode, originY: event.clientY, originStartMinute: startMinute, originDurationMinutes: durationMinutes, originDate: item.localDate };
      updatePreview({ date: item.localDate, startMinute, durationMinutes });
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const deltaMinutes = (event.clientY - state.originY) / pxPerMinute;

    if (state.mode === "move") {
      const targetDate = findDateUnderPointer(event.clientX, event.clientY) ?? state.originDate;
      const nextStart = clampStart(snapTo(state.originStartMinute + deltaMinutes, MOVE_SNAP_MINUTES), state.originDurationMinutes);
      updatePreview({ date: targetDate, startMinute: nextStart, durationMinutes: state.originDurationMinutes });
    } else if (state.mode === "resize-bottom") {
      const nextDuration = clampDuration(snapTo(state.originDurationMinutes + deltaMinutes, RESIZE_SNAP_MINUTES));
      const clampedStart = clampStart(state.originStartMinute, nextDuration);
      updatePreview({ date: state.originDate, startMinute: clampedStart, durationMinutes: nextDuration });
    } else {
      const rawStart = snapTo(state.originStartMinute + deltaMinutes, RESIZE_SNAP_MINUTES);
      const nextStart = Math.max(0, Math.min(state.originStartMinute + state.originDurationMinutes - MIN_DURATION_MINUTES, rawStart));
      const nextDuration = clampDuration(state.originStartMinute + state.originDurationMinutes - nextStart);
      updatePreview({ date: state.originDate, startMinute: nextStart, durationMinutes: nextDuration });
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragState.current = null;
    // Read the latest value from the ref (synchronous, safe outside React's render cycle) rather
    // than from state, then fire exactly one commit for the whole gesture.
    const current = previewRef.current;
    updatePreview(null);
    if (current && (current.date !== state.originDate || current.startMinute !== state.originStartMinute || current.durationMinutes !== state.originDurationMinutes)) {
      if (state.mode === "move") onMove(current.date, minutesToTime(current.startMinute));
      else onResize(minutesToTime(current.startMinute), current.durationMinutes);
    }
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLElement>) {
    // Interrupted gesture (e.g. the browser took over): discard the preview rather than commit
    // wherever the pointer happened to be when the cancel fired.
    if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
    updatePreview(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (locked || item.pending) return;
    if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      // Keyboard resize: extend/shrink from the end, matching the bottom pointer handle.
      event.preventDefault();
      const step = event.key === "ArrowUp" ? -RESIZE_SNAP_MINUTES : RESIZE_SNAP_MINUTES;
      const nextDuration = clampDuration(durationMinutes + step);
      onResize(minutesToTime(startMinute), nextDuration);
      announce(describe(startMinute, nextDuration));
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const step = event.key === "ArrowUp" ? -MOVE_SNAP_MINUTES : MOVE_SNAP_MINUTES;
      const nextStart = clampStart(startMinute + step, durationMinutes);
      onMove(item.localDate, minutesToTime(nextStart));
      announce(describe(nextStart, durationMinutes));
      return;
    }
    // No arrow-key day change: only one day is rendered now, so moving to another date goes through
    // the same route every user has -- Return to pool, switch the date strip, place it again. All
    // three are keyboard-reachable, so this removes a control without removing the capability.
  }

  return (
    <div
      className="cal-block"
      data-pending={item.pending ? "true" : undefined}
      data-conflicted={conflicted ? "true" : undefined}
      data-locked={locked ? "true" : undefined}
      data-category={item.category}
      style={{ top: minutesToPixels(displayStart, pxPerMinute), height: Math.max(minutesToPixels(displayDuration, pxPerMinute), 20) }}
      tabIndex={0}
      role="button"
      aria-label={
        item.title + ", " + minutesToTime(displayStart) + " to " + minutesToTime(displayStart + displayDuration) +
        (locked ? ", locked reservation" : "") + (conflicted ? ", overlaps another activity" : "")
      }
      data-dragging={preview ? "true" : undefined}
      // Native drag is how a pool-scheduled block is returned to the pool. It never conflicts with
      // the pointer-based time drag above: that starts on the grip handle, which preventDefaults
      // pointerdown and so suppresses the native dragstart for that gesture.
      draggable={Boolean(item.poiId) && !locked && !item.pending}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {!locked && (
        <div className="cal-resize-handle cal-resize-top" aria-hidden onPointerDown={handlePointerDown("resize-top")} />
      )}
      <span className="cal-block-handle" onPointerDown={handlePointerDown("move")}>
        {locked ? <Lock size={13} aria-hidden /> : <GripVertical size={14} aria-hidden />}
      </span>
      <span className="cal-block-text">
        <span className="cal-block-title">{item.title}</span>
        <span className="cal-block-time">{minutesToTime(displayStart)}&ndash;{minutesToTime(displayStart + displayDuration)} &middot; {displayDuration} min</span>
      </span>
      {item.pending && <LoaderCircle className="spin cal-block-status" size={14} aria-hidden />}
      {conflicted && !item.pending && <AlertTriangle className="cal-block-status cal-block-warning" size={14} aria-hidden />}
      {locked && (
        <button type="button" className="cal-unlock-button" onClick={onUnlock}>
          <LockOpen size={12} aria-hidden /> Unlock
        </button>
      )}
      {/* Keyboard-equivalent for the native drag-to-pool above, which no keyboard user can perform. */}
      {item.poiId && !locked && (
        <button type="button" className="cal-unschedule-button" onClick={onUnschedule}>
          Return to pool
        </button>
      )}
      {item.hoursUnverified && (
        <span className="cal-block-hours-warning" role="note">Hours unverified — confirm before visiting</span>
      )}
      {item.rejectedReason && <span className="cal-block-rejected" role="alert">{item.rejectedReason}</span>}
      {!locked && (
        <div className="cal-resize-handle cal-resize-bottom" aria-hidden onPointerDown={handlePointerDown("resize-bottom")} />
      )}
    </div>
  );
}
