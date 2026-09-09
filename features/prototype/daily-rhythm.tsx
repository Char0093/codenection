"use client";

import React, { useMemo, useState } from "react";
import { Sunrise, Sunset } from "lucide-react";
import { DEMO_RHYTHMS, DEMO_SELF_MEMBER_ID } from "@/lib/prototype/fixtures";

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
function fromMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

const DAY_START = 6 * 60;
const DAY_END = 24 * 60;
const SPAN = DAY_END - DAY_START;
const pct = (min: number) => `${((min - DAY_START) / SPAN) * 100}%`;

/**
 * Feature: preferred daily start & finish times. Each member sets their own usable window; the
 * planner reads the overlap as the group's shared day before generating an itinerary. This is a
 * per-trip input, not a saved global preference. Demo state only.
 */
export function DailyRhythm() {
  const others = DEMO_RHYTHMS.filter((r) => r.memberId !== DEMO_SELF_MEMBER_ID);
  const self = DEMO_RHYTHMS.find((r) => r.memberId === DEMO_SELF_MEMBER_ID)!;
  const [start, setStart] = useState(self.start);
  const [end, setEnd] = useState(self.end);

  const rows = useMemo(
    () => [{ ...self, start, end }, ...others],
    [self, others, start, end],
  );
  const overlapStart = Math.max(...rows.map((r) => toMin(r.start)));
  const overlapEnd = Math.min(...rows.map((r) => toMin(r.end)));
  const hasOverlap = overlapEnd > overlapStart;

  return (
    <section className="daily-rhythm">
      <h2>Daily rhythm</h2>
      <p className="field-hint">
        When are you good to be out? The planner uses the group&rsquo;s overlap as the usable day —
        activities are scheduled inside it.
      </p>

      <div className="daily-rhythm-inputs">
        <label><Sunrise size={14} aria-hidden="true" />Start
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label><Sunset size={14} aria-hidden="true" />Wind down
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="rhythm-strip" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.memberId} className="rhythm-row">
            <span className="rhythm-name">{r.memberId === DEMO_SELF_MEMBER_ID ? "You" : r.memberName}</span>
            <span className="rhythm-track">
              <span className="rhythm-bar" style={{ left: pct(toMin(r.start)), width: `${((toMin(r.end) - toMin(r.start)) / SPAN) * 100}%` }} />
            </span>
          </div>
        ))}
        <div className="rhythm-row rhythm-row-overlap">
          <span className="rhythm-name">Shared</span>
          <span className="rhythm-track">
            {hasOverlap && (
              <span className="rhythm-bar rhythm-bar-overlap"
                style={{ left: pct(overlapStart), width: `${((overlapEnd - overlapStart) / SPAN) * 100}%` }} />
            )}
          </span>
        </div>
      </div>

      <p className="rhythm-result" role="status">
        {hasOverlap
          ? `Group day: ${fromMin(overlapStart)}–${fromMin(overlapEnd)}`
          : "No shared window — the planner would suggest a split day."}
        <span className="demo-hint"> · demo, not saved</span>
      </p>
    </section>
  );
}
