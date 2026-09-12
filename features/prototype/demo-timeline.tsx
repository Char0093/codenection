"use client";

import React, { useMemo, useRef, useState } from "react";
import { CloudRain, Check, Lock, Save, Undo2, X } from "lucide-react";
import { DateSelector } from "@/features/timeline/date-selector";
import { useDemoTripState } from "@/features/prototype/demo-trip-state";
import { DEMO_ITINERARY, DEMO_POOL, DEMO_TRIP_DATES, type DemoBlock, type DemoPoolItem } from "@/lib/prototype/fixtures";
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

/** Native HTML drag MIME for a pool card being picked up -- distinct from the plain text/plain
 * mirror so the calendar and the pool can each tell "a pool item" apart from "a scheduled block"
 * dropped on them, the same split the real (non-prototype) timeline uses. */
const POOL_DRAG_MIME = "application/x-wandersync-demo-pool";
const BLOCK_DRAG_MIME = "application/x-wandersync-demo-block";

type Live = { id: string; startMinute: number; durationMinutes: number };
type DragState = Live & { mode: "move" | "resize"; startClientY: number; baseStart: number; baseDuration: number };
type PendingChange = { id: string; blockId: string; kind: "move" | "resize" | "add" | "remove" | "split" | "weather"; text: string };

let seq = 0;

/**
 * Prototype Timeline: a seeded single-day builder. Blocks can be dragged to a new start time
 * and resized from the bottom edge to change duration (15-minute snap); pool places can be
 * added. Everything is local state — no server write, resets on refresh.
 */
export function DemoTimeline() {
  const { postMessage } = useDemoTripState();
  const [selectedDate, setSelectedDate] = useState(DEMO_TRIP_DATES[0]);
  const [blocks, setBlocks] = useState<DemoBlock[]>(() => DEMO_ITINERARY.map((b) => ({ ...b })));
  const [live, setLive] = useState<Live | null>(null);
  const [announce, setAnnounce] = useState("");
  const drag = useRef<DragState | null>(null);
  // Pool-card pickup: which candidate is in flight, and where it would land if dropped now --
  // drives the ghost preview on the calendar. Separate from `live` (in-place move/resize), which
  // never touches the pool.
  const [draggingPoolId, setDraggingPoolId] = useState<string | null>(null);
  const [dragOverMinute, setDragOverMinute] = useState<number | null>(null);
  // A scheduled block picked up via native drag (not the pointer-based move above) so it can be
  // dropped back onto the pool to unschedule it.
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [poolDragOver, setPoolDragOver] = useState(false);
  // A pool card dropped onto an *occupied* slot instead of an empty one becomes that slot's
  // split partner rather than a new block -- this is which existing block the ghost preview is
  // currently hovering over, so the drop target itself can be highlighted before release.
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);
  // Every edit made this session that hasn't been sent to the group yet -- moves, resizes,
  // additions, removals and splits alike. Drives both the split block's "Not sent yet" badge
  // (any entry whose blockId matches) and whether the Save button has anything to do.
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
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

  // Derived, not separate state: a pool candidate is "available" exactly when no scheduled block
  // is tagged with its id. Scheduling one (any day) removes it here; removing that block (however
  // it happens -- drag back, the Remove/Return button) makes it reappear, with no extra bookkeeping.
  const availablePool = useMemo(
    () => DEMO_POOL.filter((poi) => !blocks.some((b) => b.poolId === poi.id || b.split?.poolId === poi.id)),
    [blocks],
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

  /** Appends one line to the not-yet-sent change log -- this alone is what the Save button
   * counts and enables, for any edit anywhere in the timeline. `kind` scopes retraction (below)
   * to just this *fact* about the block, so undoing a split doesn't also erase an unrelated,
   * still-pending move logged earlier for that same block id. */
  function queueChange(blockId: string, kind: PendingChange["kind"], text: string) {
    setPendingChanges((prev) => [...prev, { id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, blockId, kind, text }]);
  }

  /** For an edit that undoes an earlier not-yet-sent one of the same kind on the same block
   * (removing a split side that was itself just created, undoing a still-pending weather swap):
   * if that earlier line is still sitting unsent, drop it instead of adding a contradicting one --
   * there is nothing left to tell the group. Only once an edit has actually been sent does undoing
   * it need its own line. Any *other* pending fact about the same block (an earlier move, say) is
   * untouched. */
  function retractOrLog(blockId: string, kind: PendingChange["kind"], textIfNothingToRetract: string) {
    setPendingChanges((prev) => {
      const hadPending = prev.some((c) => c.blockId === blockId && c.kind === kind);
      const filtered = prev.filter((c) => !(c.blockId === blockId && c.kind === kind));
      if (hadPending) return filtered;
      return [...filtered, { id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, blockId, kind, text: textIfNothingToRetract }];
    });
  }

  /** Drops any not-yet-sent "split" line for `blockId` with nothing to replace it -- for the slot
   * a moved-out split half just vacated, which the move's own queueChange (for its new slot)
   * already covers. Scoped to `kind: "split"` so an unrelated pending move/resize on the same
   * block survives. */
  function retractPending(blockId: string, kind: PendingChange["kind"]) {
    setPendingChanges((prev) => prev.filter((c) => !(c.blockId === blockId && c.kind === kind)));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, b: DemoBlock) {
    if (b.locked) return;
    const isResize = Boolean((event.target as HTMLElement).closest(".cal-block-resize"));
    const mode: DragState["mode"] = isResize ? "resize" : "move";
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
      // Whole-card pointer drag doubles as "carry it out" -- live-highlight the pool (drop to
      // remove/return) or another block (drop to split with it), exactly like a pool card's own
      // native drag does, just driven by cursor position instead of a dragover event.
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const overPool = Boolean(el?.closest(".demo-pool"));
      setPoolDragOver(overPool);
      if (overPool) {
        setDragOverTargetId(null);
      } else {
        const hoveredId = el?.closest<HTMLElement>(".cal-block")?.dataset.blockId;
        const hovered = hoveredId && hoveredId !== d.id
          ? dayBlocks.find((x) => x.id === hoveredId && !x.locked && !x.split)
          : undefined;
        setDragOverTargetId(hovered ? hovered.id : null);
      }
    } else {
      d.startMinute = d.baseStart;
      d.durationMinutes = clamp(d.baseDuration + deltaMin, MIN_DURATION, Math.min(MAX_DURATION, WINDOW_END_MIN - d.baseStart));
    }
    setLive({ id: d.id, startMinute: d.startMinute, durationMinutes: d.durationMinutes });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    const droppedOnPool = poolDragOver;
    const mergeTargetId = dragOverTargetId;
    setLive(null);
    setPoolDragOver(false);
    setDragOverTargetId(null);
    if (!d) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

    if (d.mode === "move" && droppedOnPool) {
      removeBlock(d.id);
      return;
    }
    if (d.mode === "move" && mergeTargetId) {
      mergeBlockInto(d.id, mergeTargetId);
      return;
    }
    if (d.startMinute !== d.baseStart || d.durationMinutes !== d.baseDuration) {
      commit({ id: d.id, startMinute: d.startMinute, durationMinutes: d.durationMinutes });
      const title = blockTitle(d.id);
      const when = `${hhmm(d.startMinute)}–${hhmm(d.startMinute + d.durationMinutes)}`;
      setAnnounce(`${title} now ${when}`);
      queueChange(d.id, d.mode, d.mode === "resize" ? `${title} resized to ${when} on ${selectedDate}` : `${title} moved to ${when} on ${selectedDate}`);
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
    const when = `${hhmm(next.startMinute)}–${hhmm(next.startMinute + next.durationMinutes)}`;
    setAnnounce(`${b.title} now ${when}`);
    queueChange(b.id, event.shiftKey ? "resize" : "move", event.shiftKey ? `${b.title} resized to ${when} on ${b.date}` : `${b.title} moved to ${when} on ${b.date}`);
  }

  /** Dropped or clicked from the pool. `startMinute` comes from where it was dropped on the
   * calendar; the click fallback (the "Add" button) omits it and falls back to right after the
   * last block. Tagging the new block with `poolId` is what makes it vanish from the pool below
   * (see `availablePool`) and reappear there if it's later removed. */
  function addFromPool(poolId: string, startMinute?: number) {
    const poi = DEMO_POOL.find((p) => p.id === poolId);
    if (!poi) return;
    const last = dayBlocks[dayBlocks.length - 1];
    const fallback = last
      ? clamp(last.startMinute + last.durationMinutes + 30, WINDOW_START_MIN, WINDOW_END_MIN - poi.durationMinutes)
      : 9 * 60;
    const start = startMinute !== undefined
      ? clamp(startMinute, WINDOW_START_MIN, WINDOW_END_MIN - poi.durationMinutes)
      : fallback;
    seq += 1;
    const id = `added-${seq}`;
    setBlocks((prev) => [...prev, {
      id, title: poi.name, category: poi.category, date: selectedDate,
      startMinute: start, durationMinutes: poi.durationMinutes, poolId: poi.id,
    }]);
    setAnnounce(`${poi.name} added at ${hhmm(start)}`);
    queueChange(id, "add", `${poi.name} added at ${hhmm(start)} on ${selectedDate}`);
  }

  function removeBlock(id: string) {
    const removed = blocks.find((b) => b.id === id);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (!removed) return;
    const text = removed.poolId ? `${removed.title} returned to the pool` : `${removed.title} removed`;
    setAnnounce(text);
    // Whatever not-yet-sent history this block had (a move, say) no longer matters once it's
    // gone -- except if it was purely "added this session", in which case it appeared and vanished
    // before anyone saw it, and there is nothing at all worth telling the group.
    setPendingChanges((prev) => {
      const existing = prev.filter((c) => c.blockId === id);
      const filtered = prev.filter((c) => c.blockId !== id);
      const onlyAddedThisSession = existing.length > 0 && existing.every((c) => c.kind === "add");
      if (onlyAddedThisSession) return filtered;
      return [...filtered, { id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, blockId: id, kind: "remove", text }];
    });
  }

  /** The one existing, unlocked, not-already-split block a drop at this time would land inside
   * of -- that's what turns a pool drop into a split instead of a new standalone block. Only one
   * split partner is supported per slot, so an already-split block is never a target again.
   * `excludeId` leaves out the block currently being relocated, so dropping it back over its own
   * old spot (or a spot it briefly passed over) is never mistaken for splitting with itself. */
  function findSplitTarget(startMinute: number, durationMinutes: number, excludeId?: string): DemoBlock | undefined {
    const end = startMinute + durationMinutes;
    return dayBlocks.find((existing) => existing.id !== excludeId && !existing.locked && !existing.split
      && startMinute < existing.startMinute + existing.durationMinutes && end > existing.startMinute);
  }

  /** Drops `poi` into the same slot as `blockId`, so the slot renders as two places side by
   * side. Marked pending until Save sends word of it to the group -- "everyone agrees" is
   * simulated for the prototype by rendering the split immediately rather than gating it on
   * the other members actually responding. */
  function createSplit(blockId: string, poi: DemoPoolItem) {
    const target = blocks.find((b) => b.id === blockId);
    setBlocks((prev) => prev.map((b) => (b.id === blockId
      ? { ...b, split: { title: poi.name, category: poi.category, poolId: poi.id } }
      : b)));
    setAnnounce(`${poi.name} split into the same slot as ${blockTitle(blockId)} — save to tell the group`);
    if (target) {
      queueChange(blockId, "split", `${hhmm(target.startMinute)}–${hhmm(target.startMinute + target.durationMinutes)} on ${target.date}: ${target.title} or ${poi.name}`);
    }
  }

  /** Removing either side collapses the slot back to one plain block: the other side survives,
   * promoted to the whole slot if it was the primary that got removed. */
  function removeSplitSide(blockId: string, side: "primary" | "split") {
    let removedTitle = "";
    let remainingTitle = "";
    setBlocks((prev) => prev.map((b) => {
      if (b.id !== blockId || !b.split) return b;
      if (side === "split") {
        removedTitle = b.split.title;
        remainingTitle = b.title;
        const { split: _split, ...rest } = b;
        return rest;
      }
      removedTitle = b.title;
      remainingTitle = b.split.title;
      return {
        id: b.id, date: b.date, startMinute: b.startMinute, durationMinutes: b.durationMinutes,
        title: b.split.title, category: b.split.category, poolId: b.split.poolId,
      };
    }));
    if (removedTitle) {
      setAnnounce(`${removedTitle} removed from the split`);
      retractOrLog(blockId, "split", `${removedTitle} removed from the split — only ${remainingTitle} stays in that slot`);
    }
  }

  /** A whole block, carried by its own pointer-based move and released over another block instead
   * of empty track: `source` leaves its old slot entirely and becomes `target`'s split partner.
   * `source`'s own history (an earlier move, say) is dropped along with it -- what matters now is
   * the fresh "these two are sharing a slot" fact logged for `target`. */
  function mergeBlockInto(sourceId: string, targetId: string) {
    const source = blocks.find((b) => b.id === sourceId);
    const target = blocks.find((b) => b.id === targetId);
    if (!source || !target || source.locked || source.split || target.locked || target.split) return;
    setBlocks((prev) => prev
      .filter((b) => b.id !== sourceId)
      .map((b) => (b.id === targetId
        ? { ...b, split: { title: source.title, category: source.category, poolId: source.poolId } }
        : b)));
    setAnnounce(`${source.title} split into ${target.title}'s slot`);
    setPendingChanges((prev) => [
      ...prev.filter((c) => c.blockId !== sourceId),
      { id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, blockId: targetId, kind: "split",
        text: `${hhmm(target.startMinute)}–${hhmm(target.startMinute + target.durationMinutes)} on ${target.date}: ${target.title} or ${source.title}` },
    ]);
  }

  /** One side of a split, picked up and dropped somewhere else on the calendar -- the same
   * merge-or-standalone rule a pool drop follows. A whole (non-split) block instead relocates via
   * its own pointer-based move (see onPointerMove/endDrag above), so this only ever fires for
   * "blockId::side" drag ids (see each split half's onDragStart below); anything else is left
   * alone. */
  function relocateItem(dragId: string, clientY: number, container: HTMLElement) {
    const [blockId, side] = dragId.split("::");
    if (side !== "primary" && side !== "split") return;
    const source = blocks.find((b) => b.id === blockId);
    if (!source?.split) return;

    const moving = side === "split"
      ? { title: source.split.title, category: source.split.category, poolId: source.split.poolId }
      : { title: source.title, category: source.category, poolId: source.poolId };
    const withoutSource: DemoBlock[] = side === "split"
      ? blocks.map((b): DemoBlock => {
        if (b.id !== blockId) return b;
        const { split: _split, ...rest } = b;
        return rest;
      })
      : blocks.map((b): DemoBlock => (b.id === blockId
        ? { id: b.id, date: b.date, startMinute: b.startMinute, durationMinutes: b.durationMinutes,
          title: source.split!.title, category: source.split!.category, poolId: source.split!.poolId }
        : b));

    const durationMinutes = source.durationMinutes;
    const startMinute = minuteFromClientY(clientY, container, durationMinutes);
    const end = startMinute + durationMinutes;
    const target = withoutSource.find((b) => b.date === selectedDate && b.id !== blockId && !b.locked && !b.split
      && startMinute < b.startMinute + b.durationMinutes && end > b.startMinute);

    // The half being moved away leaves its old slot behind, whatever that resolves to -- if that
    // was still an unsent split, there's nothing left of it to tell the group (the arrival at the
    // new slot below gets its own, fresh queueChange).
    retractPending(blockId, "split");

    if (target) {
      setBlocks(withoutSource.map((b) => (b.id === target.id
        ? { ...b, split: { title: moving.title, category: moving.category, poolId: moving.poolId } }
        : b)));
      setAnnounce(`${moving.title} split into ${target.title}'s slot`);
      queueChange(target.id, "split", `${hhmm(target.startMinute)}–${hhmm(target.startMinute + target.durationMinutes)} on ${target.date}: ${target.title} or ${moving.title}`);
      return;
    }

    seq += 1;
    const newId = `moved-${seq}`;
    setBlocks([...withoutSource, {
      id: newId, title: moving.title, category: moving.category, date: selectedDate,
      startMinute, durationMinutes, poolId: moving.poolId,
    }]);
    setAnnounce(`${moving.title} moved to ${hhmm(startMinute)}–${hhmm(end)}`);
    queueChange(newId, "move", `${moving.title} moved to ${hhmm(startMinute)}–${hhmm(end)} on ${selectedDate}`);
  }

  /** The Save button next to the day tabs: turns every not-yet-sent edit into one message in the
   * group chat (via the trip-wide DemoTripStateProvider). */
  function saveChanges() {
    if (pendingChanges.length === 0) return;
    const lines = pendingChanges.map((c) => c.text);
    postMessage(lines.length === 1
      ? `Here's a change to the plan — ${lines[0]}. Let me know if that works.`
      : `A few changes to the plan: ${lines.join("; ")}. Let me know if those work.`);
    setPendingChanges([]);
    setAnnounce("Sent to the group chat");
  }

  /** Where a pointer at `clientY` lands on the calendar, in minutes -- used for both the drop
   * preview while dragging and the actual drop. `container` is `.cal-column` itself, whose own
   * box is the same coordinate space the blocks are positioned in (top = WINDOW_START_MIN). */
  function minuteFromClientY(clientY: number, container: HTMLElement, durationMinutes: number): number {
    const rect = container.getBoundingClientRect();
    const raw = WINDOW_START_MIN + (clientY - rect.top) / PX_PER_MIN;
    return clamp(snap(raw), WINDOW_START_MIN, WINDOW_END_MIN - durationMinutes);
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
    queueChange(DEMO_WEATHER.affectedBlockId, "weather", `${DEMO_WEATHER.affectedTitle} swapped indoors for ${DEMO_WEATHER.replacement.title} (rain)`);
  }

  function undoReplacement() {
    if (undoSnapshot.current) setBlocks(undoSnapshot.current);
    undoSnapshot.current = null;
    setWeather("idle");
    retractOrLog(DEMO_WEATHER.affectedBlockId, "weather", `The indoor swap for ${DEMO_WEATHER.affectedTitle} was undone — it's back outdoors`);
  }

  const atRiskId = weather === "warned" ? DEMO_WEATHER.affectedBlockId : null;

  const hourTicks: number[] = [];
  for (let m = WINDOW_START_MIN; m <= WINDOW_END_MIN; m += 60) hourTicks.push(m);

  return (
    <div className="timeline-pane" aria-label="Day builder">
      <div className="demo-timeline-toolbar">
        <DateSelector dates={DEMO_TRIP_DATES} selectedDate={selectedDate} onSelect={setSelectedDate} scheduledCountByDate={countByDate} />
        <button
          type="button"
          className="primary-button"
          disabled={pendingChanges.length === 0}
          onClick={saveChanges}
          title={pendingChanges.length === 0 ? "Nothing new to send" : "Send the pending change(s) to the group chat"}
        >
          <Save aria-hidden="true" />Save{pendingChanges.length > 0 ? ` (${pendingChanges.length})` : ""}
        </button>
      </div>
      <p className="demo-hint">
        Demo — drag a block to move it, drag its bottom edge to change duration (arrow keys work too;
        hold Shift to resize). Drop a pool place onto an existing block to split that slot between
        two options. Nothing here is saved to a server; it resets on refresh.
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
        <div
          className="demo-pool"
          aria-label="Places you can add"
          data-drag-over={poolDragOver ? "true" : undefined}
          onDragOver={(event) => {
            if (!draggingBlockId) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setPoolDragOver(true);
          }}
          onDragLeave={() => setPoolDragOver(false)}
          onDrop={(event) => {
            setPoolDragOver(false);
            // A whole block returns to the pool via its own pointer-based move (endDrag above)
            // releasing over this panel; only a split half still uses native drag to get here.
            const id = event.dataTransfer.getData(BLOCK_DRAG_MIME);
            const [blockId, side] = id.split("::");
            if (side !== "primary" && side !== "split") return;
            event.preventDefault();
            removeSplitSide(blockId, side);
          }}
        >
          <h3>Choice pool</h3>
          {availablePool.length === 0
            ? <p className="poi-pool-empty">Every place has been added — drag a block back here to free it up again.</p>
            : <ul>
                {availablePool.map((poi) => (
                  <li
                    key={poi.id}
                    className="demo-pool-card"
                    data-dragging={draggingPoolId === poi.id ? "true" : undefined}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(POOL_DRAG_MIME, poi.id);
                      event.dataTransfer.setData("text/plain", poi.id);
                      event.dataTransfer.effectAllowed = "copy";
                      setDraggingPoolId(poi.id);
                    }}
                    onDragEnd={() => { setDraggingPoolId(null); setDragOverMinute(null); }}
                  >
                    <div className="demo-pool-body">
                      <strong>{poi.name}</strong>
                      <span className="demo-pool-meta">{poi.category} · {poi.durationMinutes} min · {poi.costTier}</span>
                      <span className="demo-pool-blurb">{poi.blurb}</span>
                      <span className={`demo-safety demo-safety-${poi.safety}`}>{poi.safety} safety data</span>
                    </div>
                  </li>
                ))}
              </ul>}
        </div>

        <div className="cal-viewport">
          <div className="cal-body" style={{ height: TRACK_PX }}>
            <div className="cal-ruler">
              {hourTicks.map((m) => (
                <span key={m} className="cal-tick" style={{ top: (m - WINDOW_START_MIN) * PX_PER_MIN }}>{hhmm(m)}</span>
              ))}
            </div>
            <div
              className="cal-column"
              onDragOver={(event) => {
                if (draggingPoolId) {
                  const poi = DEMO_POOL.find((p) => p.id === draggingPoolId);
                  if (!poi) return;
                  event.preventDefault();
                  const minute = minuteFromClientY(event.clientY, event.currentTarget, poi.durationMinutes);
                  event.dataTransfer.dropEffect = "copy";
                  setDragOverMinute(minute);
                  setDragOverTargetId(findSplitTarget(minute, poi.durationMinutes)?.id ?? null);
                  return;
                }
                if (draggingBlockId?.includes("::")) {
                  const [blockId] = draggingBlockId.split("::");
                  const source = blocks.find((b) => b.id === blockId);
                  if (!source) return;
                  event.preventDefault();
                  const minute = minuteFromClientY(event.clientY, event.currentTarget, source.durationMinutes);
                  event.dataTransfer.dropEffect = "move";
                  setDragOverMinute(minute);
                  setDragOverTargetId(findSplitTarget(minute, source.durationMinutes, blockId)?.id ?? null);
                }
              }}
              onDragLeave={() => { setDragOverMinute(null); setDragOverTargetId(null); }}
              onDrop={(event) => {
                setDragOverMinute(null);
                setDragOverTargetId(null);
                const poolId = event.dataTransfer.getData(POOL_DRAG_MIME);
                if (poolId) {
                  const poi = DEMO_POOL.find((p) => p.id === poolId);
                  if (!poi) return;
                  event.preventDefault();
                  // Computed fresh from the drop event itself, not the preview state -- a drop can
                  // in principle land before that state's re-render has flushed, and both the
                  // placement and the split-target decision must never depend on winning that race.
                  const minute = minuteFromClientY(event.clientY, event.currentTarget, poi.durationMinutes);
                  const target = findSplitTarget(minute, poi.durationMinutes);
                  if (target) createSplit(target.id, poi);
                  else addFromPool(poolId, minute);
                  return;
                }
                const dragId = event.dataTransfer.getData(BLOCK_DRAG_MIME);
                if (dragId.includes("::")) {
                  event.preventDefault();
                  relocateItem(dragId, event.clientY, event.currentTarget);
                }
              }}
            >
              {dragOverTargetId === null && dragOverMinute !== null && (() => {
                let durationMinutes: number | null = null;
                if (draggingPoolId) durationMinutes = DEMO_POOL.find((p) => p.id === draggingPoolId)?.durationMinutes ?? null;
                else if (draggingBlockId) {
                  const [blockId] = draggingBlockId.split("::");
                  durationMinutes = blocks.find((b) => b.id === blockId)?.durationMinutes ?? null;
                }
                if (durationMinutes === null) return null;
                return (
                  <div
                    className="cal-drop-preview"
                    aria-hidden="true"
                    style={{ top: (dragOverMinute - WINDOW_START_MIN) * PX_PER_MIN, height: durationMinutes * PX_PER_MIN }}
                  />
                );
              })()}
              {dayBlocks.map((b) => {
                const s = shownFor(b);
                const topStyle = { top: (s.startMinute - WINDOW_START_MIN) * PX_PER_MIN, height: s.durationMinutes * PX_PER_MIN };

                if (b.split) {
                  const pending = pendingChanges.some((c) => c.blockId === b.id);
                  const sides: Array<{ key: "primary" | "split"; title: string; category: DemoBlock["category"]; poolId?: string }> = [
                    { key: "primary", title: b.title, category: b.category, poolId: b.poolId },
                    { key: "split", title: b.split.title, category: b.split.category, poolId: b.split.poolId },
                  ];
                  return (
                    <div
                      key={b.id}
                      className={`cal-block cal-block-split${b.locked ? " cal-block-locked" : ""}`}
                      data-conflicted={conflictIds.has(b.id) ? "true" : undefined}
                      style={topStyle}
                    >
                      <div className="cal-block-time">{hhmm(s.startMinute)}–{hhmm(s.startMinute + s.durationMinutes)}</div>
                      <div className="cal-split-halves">
                        {sides.map((side) => {
                          const dragId = `${b.id}::${side.key}`;
                          return (
                            <div
                              key={side.key}
                              className={`cal-split-half cat-${side.category}`}
                              data-dragging={draggingBlockId === dragId ? "true" : undefined}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(BLOCK_DRAG_MIME, dragId);
                                event.dataTransfer.setData("text/plain", dragId);
                                event.dataTransfer.effectAllowed = "move";
                                setDraggingBlockId(dragId);
                              }}
                              onDragEnd={() => { setDraggingBlockId(null); setDragOverMinute(null); setDragOverTargetId(null); }}
                            >
                              <span className="cal-split-title">{side.title}</span>
                            </div>
                          );
                        })}
                      </div>
                      {pending && <span className="cal-split-pending">Not sent yet</span>}
                    </div>
                  );
                }

                return (
                  <div
                    key={b.id}
                    data-block-id={b.id}
                    className={`cal-block cat-${b.category}${b.locked ? " cal-block-locked" : ""}`}
                    data-dragging={live?.id === b.id ? "true" : undefined}
                    data-conflicted={conflictIds.has(b.id) ? "true" : undefined}
                    data-atrisk={b.id === atRiskId ? "true" : undefined}
                    data-split-target={dragOverTargetId === b.id ? "true" : undefined}
                    style={topStyle}
                    role={b.locked ? undefined : "button"}
                    tabIndex={b.locked ? undefined : 0}
                    aria-label={b.locked ? undefined : `${b.title}, ${hhmm(s.startMinute)} to ${hhmm(s.startMinute + s.durationMinutes)}. Arrow keys move, Shift plus arrow keys resize.`}
                    // The whole card starts the move gesture (only the resize handle at the
                    // bottom edge is carved out, in onPointerDown) -- dragging it over the pool
                    // returns/removes it, dragging it onto another block splits that slot with it,
                    // otherwise releasing it just repositions it. See onPointerMove/endDrag above.
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
                    {!b.locked && <div className="cal-block-resize" aria-hidden="true" />}
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
