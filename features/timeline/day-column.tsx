import React, { useState } from "react";
import { ActivityCard } from "@/features/timeline/activity-card";
import type { DragItem } from "@/features/timeline/use-drag-commit";

const DEFAULT_DAY_START = "09:00";
const BUFFER_MINUTES = 15;
export const KEYBOARD_STEP_MINUTES = 30;

export function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return String(Math.floor(clamped / 60)).padStart(2, "0") + ":" + String(clamped % 60).padStart(2, "0");
}

export function DayColumn({ date, items, conflictedIds, onDrop }: {
  date: string;
  items: readonly DragItem[];
  conflictedIds: ReadonlySet<string>;
  onDrop: (itemId: string, date: string, startTime: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const sorted = items.slice().sort((left, right) => left.localStartTime.localeCompare(right.localStartTime));

  function handleDrop(event: React.DragEvent<HTMLUListElement>, beforeIndex: number) {
    event.preventDefault();
    setDragOver(false);
    const itemId = event.dataTransfer.getData("text/plain");
    if (!itemId) return;
    const targetItems = sorted.filter((entry) => entry.id !== itemId);
    const previous = targetItems[beforeIndex - 1];
    const startTime = previous ? addMinutes(previous.localEndTime, BUFFER_MINUTES) : DEFAULT_DAY_START;
    onDrop(itemId, date, startTime);
  }

  return <section className="day-column" aria-label={"Day " + date}>
    <h3 className="day-column-heading">{date}</h3>
    <ul
      className="day-column-list"
      data-drag-over={dragOver ? "true" : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => handleDrop(event, sorted.length)}
    >
      {sorted.map((item) => (
        <ActivityCard key={item.id} item={item} conflicted={conflictedIds.has(item.id)}
          onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
          onNudge={(minutes) => onDrop(item.id, date, addMinutes(item.localStartTime, minutes))} />
      ))}
      {sorted.length === 0 && <li className="day-column-empty">Drop an activity here</li>}
    </ul>
  </section>;
}
