"use client";

import React, { useMemo, useRef, useState } from "react";
import { CloudRain, Check, Lock, Plus, Undo2, X } from "lucide-react";
import { DateSelector } from "@/features/timeline/date-selector";
import { DEMO_ITINERARY, DEMO_POOL, DEMO_TRIP_DATES, type DemoBlock } from "@/lib/prototype/fixtures";
import { DEMO_WEATHER } from "@/lib/prototype/demo-features";

const WINDOW_START_MIN = 6 * 60;
const WINDOW_END_MIN = 23 * 60;
const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const MIN_DURATION = 15;
const MAX_DURATION = 8 * 60;
const TRACK_PX = (WINDOW_END_MIN - WINDOW_START_MIN) * PX_PER_MIN;

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const snap = (n: number) => Math.round(n / SNAP_MIN) * SNAP_MIN;

type Live = { id: string; startMinute: number; durationMinutes: number };
type DragState = Live & { mode: "move" | "resize"; startClientY: number; baseStart: number; baseDuration: number };

let seq = 0;

/**
 * Prototype Timeline: a seeded single-day builder. Blocks can be dragged to a new start time
 * and resized from the bottom edge to change duration (15-minute snap); pool places can be
 * added. Everything is local state — no server write, resets on refresh.
 */
export function DemoTimeline() {
  const [selectedDate, setSelectedDate] = useState(DEMO_TRIP_DATES[0]);
  const [blocks, setBlocks] = useState<DemoBlock[]>(() => DEMO_ITINERARY.map((b) => ({ ...b })));
  const [live, setLive] = useState<Live | null>(null);
  const [announce, setAnnounce] = useState("");
  const drag = useRef<DragState | null>(null);
  // Weather disruption: idle -> warned (rain simulated) -> applied (block swapped).
  const [weather, setWeather] = useState<"idle" | "warned" | "applied">("idle");
  const undoSnapshot = useRef<DemoBlock[] | null>(null);

  const countByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const date of DEMO_TRIP_DATES) map.set(date, 0);
    for (const b of blocks) map.set(b.date, (map.get(b.date) ?? 0) + 1);
    return map;
  }, [blocks]);

  const dayBlocks = useMemo(
    () => blocks.filter((b) => b.date === selectedDate).sort((a, b) => a.startMinute - b.startMinute),
    [blocks, selectedDate],
  );

  /** Start/duration to render for a block right now — the live drag preview wins. */
  const shownFor = (b: DemoBlock): Live =>
    live && live.id === b.id ? live : { id: b.id, startMinute: b.startMinute, durationMinutes: b.durationMinutes };

  const conflictIds = useMemo(() => {
    const shown = dayBlocks.map(shownFor).sort((a, b) => a.startMinute - b.startMinute);
    const bad = new Set<string>();
    for (let i = 0; i < shown.length; i += 1) {
      for (let j = i + 1; j < shown.length; j += 1) {
        if (shown[j].startMinute < shown[i].startMinute + shown[i].durationMinutes) {
          bad.add(shown[i].id);
          bad.add(shown[j].id);
        }
      }
    }
    return bad;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayBlocks, live]);

  function commit(next: Live) {
    setBlocks((prev) => prev.map((b) => (b.id === next.id
      ? { ...b, startMinute: next.startMinute, durationMinutes: next.durationMinutes }
      : b)));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, b: DemoBlock) {
    if (b.locked) return;
    if ((event.target as HTMLElement).closest(".cal-block-remove")) return;
    const mode: DragState["mode"] = (event.target as HTMLElement).closest(".cal-block-resize") ? "resize" : "move";
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      id: b.id, mode, startClientY: event.clientY,
      baseStart: b.startMinute, baseDuration: b.durationMinutes,
      startMinute: b.startMinute, durationMinutes: b.durationMinutes,
    };
    setLive({ id: b.id, startMinute: b.startMinute, durationMinutes: b.durationMinutes });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const deltaMin = snap((event.clientY - d.startClientY) / PX_PER_MIN);
    if (d.mode === "move") {
      d.startMinute = clamp(d.baseStart + deltaMin, WINDOW_START_MIN, WINDOW_END_MIN - d.baseDuration);
      d.durationMinutes = d.baseDuration;
    } else {
      d.startMinute = d.baseStart;
      d.durationMinutes = clamp(d.baseDuration + deltaMin, MIN_DURATION, Math.min(MAX_DURATION, WINDOW_END_MIN - d.baseStart));
    }
    setLive({ id: d.id, startMinute: d.startMinute, durationMinutes: d.durationMinutes });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    setLive(null);
    if (!d) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (d.startMinute !== d.baseStart || d.durationMinutes !== d.baseDuration) {
      commit({ id: d.id, startMinute: d.startMinute, durationMinutes: d.durationMinutes });
      setAnnounce(`${blockTitle(d.id)} now ${hhmm(d.startMinute)}–${hhmm(d.startMinute + d.durationMinutes)}`);
    }
  }

  function blockTitle(id: string) {
    return blocks.find((b) => b.id === id)?.title ?? "Activity";
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, b: DemoBlock) {
    if (b.locked) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const dir = event.key === "ArrowUp" ? -1 : 1;
    let next: Live;
    if (event.shiftKey) {
      const durationMinutes = clamp(b.durationMinutes + dir * SNAP_MIN, MIN_DURATION, Math.min(MAX_DURATION, WINDOW_END_MIN - b.startMinute));
      next = { id: b.id, startMinute: b.startMinute, durationMinutes };
    } else {
      const startMinute = clamp(b.startMinute + dir * SNAP_MIN, WINDOW_START_MIN, WINDOW_END_MIN - b.durationMinutes);
      next = { id: b.id, startMinute, durationMinutes: b.durationMinutes };
    }
    commit(next);
    setAnnounce(`${b.title} now ${hhmm(next.startMinute)}–${hhmm(next.startMinute + next.durationMinutes)}`);
  }

  function addFromPool(poolId: string) {
    const poi = DEMO_POOL.find((p) => p.id === poolId);
    if (!poi) return;
    const last = dayBlocks[dayBlocks.length - 1];
    const start = last
      ? clamp(last.startMinute + last.durationMinutes + 30, WINDOW_START_MIN, WINDOW_END_MIN - poi.durationMinutes)
      : 9 * 60;
    seq += 1;
    setBlocks((prev) => [...prev, {
      id: `added-${seq}`, title: poi.name, category: poi.category, date: selectedDate,
      startMinute: start, durationMinutes: poi.durationMinutes,
    }]);
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  /** Simulate the forecast turning bad: jump to the affected day and flag the outdoor block. */
  function simulateRain() {
    setSelectedDate(DEMO_WEATHER.date);
    setWeather("warned");
  }

  /** Swap the at-risk block for the indoor replacement, keeping an undo snapshot. */
  function applyReplacement() {
    undoSnapshot.current = blocks.map((b) => ({ ...b }));
    setBlocks((prev) => prev.map((b) => (b.id === DEMO_WEATHER.affectedBlockId
      ? {
        ...b,
        title: DEMO_WEATHER.replacement.title,
        category: "culture" as const,
        startMinute: DEMO_WEATHER.replacement.startMinute,
        durationMinutes: DEMO_WEATHER.replacement.durationMinutes,
        note: "Indoor swap — rain",
      }
      : b)));
    setWeather("applied");
    setAnnounce(`${DEMO_WEATHER.affectedTitle} replaced with ${DEMO_WEATHER.replacement.title}`);
  }

  function undoReplacement() {
    if (undoSnapshot.current) setBlocks(undoSnapshot.current);
    undoSnapshot.current = null;
    setWeather("idle");
  }

  const atRiskId = weather === "warned" ? DEMO_WEATHER.affectedBlockId : null;

  const hourTicks: number[] = [];
  for (let m = WINDOW_START_MIN; m <= WINDOW_END_MIN; m += 60) hourTicks.push(m);

  return (
    <div className="timeline-pane" aria-label="Day builder">
      <DateSelector dates={DEMO_TRIP_DATES} selectedDate={selectedDate} onSelect={setSelectedDate} scheduledCountByDate={countByDate} />
      <p className="demo-hint">
        Demo — drag a block to move it, drag its bottom edge to change duration (arrow keys work too;
        hold Shift to resize). Nothing here is saved; it resets on refresh.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      {/* Weather disruption */}
      {weather === "idle" && (
        <div className="wx-bar">
          <CloudRain size={15} aria-hidden="true" />
          <span>Forecasts change. See what happens when they do.</span>
          <button type="button" className="secondary-button" onClick={simulateRain}>Simulate rain</button>
        </div>
      )}

      {weather === "warned" && (
        <div className="wx-alert" role="alert">
          <div className="wx-alert-head">
            <CloudRain size={16} aria-hidden="true" />
            <div>
              <strong>{DEMO_WEATHER.headline}</strong>
              <p>{DEMO_WEATHER.detail}</p>
            </div>
          </div>
          <p className="wx-affected">
            <strong>{DEMO_WEATHER.affectedTitle}</strong> sits inside the rain window and is outdoors.
          </p>
          <div className="wx-swap">
            <span className="wx-swap-from">{DEMO_WEATHER.affectedTitle}</span>
            <span className="wx-swap-arrow" aria-hidden="true">→</span>
            <span className="wx-swap-to">{DEMO_WEATHER.replacement.title}</span>
          </div>
          <p className="field-hint">{DEMO_WEATHER.replacement.why}</p>
          <div className="wx-actions">
            <button type="button" className="primary-button" onClick={applyReplacement}>
              <Check aria-hidden="true" />Use the indoor plan
            </button>
            <button type="button" className="secondary-button" onClick={() => setWeather("idle")}>
              <X aria-hidden="true" />Keep the original
            </button>
          </div>
        </div>
      )}

      {weather === "applied" && (
        <div className="wx-applied" role="status">
          <Check size={15} aria-hidden="true" />
          <span>Saturday afternoon moved indoors — <strong>{DEMO_WEATHER.replacement.title}</strong> replaces {DEMO_WEATHER.affectedTitle}.</span>
          <button type="button" className="secondary-button" onClick={undoReplacement}>
            <Undo2 aria-hidden="true" />Undo
          </button>
        </div>
      )}

      <div className="cal-builder">
        <div className="demo-pool" aria-label="Places you can add">
          <h3>Choice pool</h3>
          <ul>
            {DEMO_POOL.map((poi) => (
              <li key={poi.id} className="demo-pool-card">
                <div className="demo-pool-body">
                  <strong>{poi.name}</strong>
                  <span className="demo-pool-meta">{poi.category} · {poi.durationMinutes} min · {poi.costTier}</span>
                  <span className="demo-pool-blurb">{poi.blurb}</span>
                  <span className={`demo-safety demo-safety-${poi.safety}`}>{poi.safety} safety data</span>
                </div>
                <button type="button" className="secondary-button" onClick={() => addFromPool(poi.id)}>
                  <Plus aria-hidden="true" />Add to {selectedDate.slice(5)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="cal-viewport">
          <div className="cal-body" style={{ height: TRACK_PX }}>
            <div className="cal-ruler">
              {hourTicks.map((m) => (
                <span key={m} className="cal-tick" style={{ top: (m - WINDOW_START_MIN) * PX_PER_MIN }}>{hhmm(m)}</span>
              ))}
            </div>
            <div className="cal-column">
              {dayBlocks.map((b) => {
                const s = shownFor(b);
                const dragging = live?.id === b.id;
                return (
                  <div
                    key={b.id}
                    className={`cal-block cat-${b.category}${b.locked ? " cal-block-locked" : ""}`}
                    data-dragging={dragging ? "true" : undefined}
                    data-conflicted={conflictIds.has(b.id) ? "true" : undefined}
                    data-atrisk={b.id === atRiskId ? "true" : undefined}
                    style={{ top: (s.startMinute - WINDOW_START_MIN) * PX_PER_MIN, height: s.durationMinutes * PX_PER_MIN }}
                    role={b.locked ? undefined : "button"}
                    tabIndex={b.locked ? undefined : 0}
                    aria-label={b.locked ? undefined : `${b.title}, ${hhmm(s.startMinute)} to ${hhmm(s.startMinute + s.durationMinutes)}. Arrow keys move, Shift plus arrow keys resize.`}
                    onPointerDown={(event) => onPointerDown(event, b)}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(event) => onKeyDown(event, b)}
                  >
                    <div className="cal-block-title">
                      {b.locked && <Lock size={11} aria-hidden="true" />}{b.title}
                    </div>
                    <div className="cal-block-time">{hhmm(s.startMinute)}–{hhmm(s.startMinute + s.durationMinutes)}</div>
                    {b.note && <div className="cal-block-note">{b.note}</div>}
                    {!b.locked && (
                      <>
                        <button type="button" className="cal-block-remove" aria-label={`Remove ${b.title}`} onClick={() => removeBlock(b.id)}>
                          Remove
                        </button>
                        <div className="cal-block-resize" aria-hidden="true" />
                      </>
                    )}
                  </div>
                );
              })}
              {dayBlocks.length === 0 && <p className="cal-empty">Nothing planned for this day yet — add from the pool.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
