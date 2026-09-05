import React from "react";
import { AlertTriangle, GripVertical, LoaderCircle } from "lucide-react";
import { KEYBOARD_STEP_MINUTES } from "@/features/timeline/day-column";
import type { DragItem } from "@/features/timeline/use-drag-commit";

export function ActivityCard({ item, conflicted, onDragStart, onNudge }: {
  item: DragItem;
  conflicted: boolean;
  onDragStart: (event: React.DragEvent<HTMLLIElement>) => void;
  onNudge: (minutes: number) => void;
}) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLLIElement>) {
    if (item.pending) return;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      onNudge(-KEYBOARD_STEP_MINUTES);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      onNudge(KEYBOARD_STEP_MINUTES);
    }
  }

  return <li
    className="activity-card"
    draggable={!item.pending}
    tabIndex={0}
    role="button"
    onDragStart={onDragStart}
    onKeyDown={handleKeyDown}
    data-pending={item.pending ? "true" : undefined}
    data-conflicted={conflicted ? "true" : undefined}
    aria-label={item.title + ", " + item.localStartTime.slice(0, 5) + (conflicted ? ", overlaps another activity" : "")}
  >
    <span className="activity-card-handle"><GripVertical size={14} aria-hidden /></span>
    <span className="activity-card-time">{item.localStartTime.slice(0, 5)}</span>
    <span className="activity-card-title">{item.title}</span>
    {item.pending && <LoaderCircle className="spin activity-card-status" size={14} aria-hidden />}
    {conflicted && !item.pending && <AlertTriangle className="activity-card-status activity-card-warning" size={14} aria-hidden />}
    {item.rejectedReason && <span className="activity-card-rejected" role="alert">{item.rejectedReason}</span>}
  </li>;
}
