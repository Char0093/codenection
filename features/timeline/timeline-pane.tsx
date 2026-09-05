"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { DateSelector } from "@/features/timeline/date-selector";
import { DayColumn, type DropGuide } from "@/features/timeline/day-column";
import { PoiChoicePool } from "@/features/timeline/poi-choice-pool";
import { PoiDetailSheet } from "@/features/timeline/poi-detail-sheet";
import { useDragCommit, type DragItem } from "@/features/timeline/use-drag-commit";
import { useResizeCommit } from "@/features/timeline/use-resize-commit";
import { MINUTES_PER_DAY, minutesToPixels, minutesToTime } from "@/features/timeline/calendar-geometry";
import type { PoolCandidate } from "@/lib/poi/choice-pool";
import { evaluateDrop } from "@/lib/poi/opening-hours";

const PX_PER_MINUTE = 1.2;
const DEFAULT_SCROLL_HOUR = 7;
const TRACK_HEIGHT_PX = minutesToPixels(MINUTES_PER_DAY, PX_PER_MINUTE);

function tripDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

/** Same-day overlap, purely for the visual warning -- the server is the actual source of truth. */
function detectDayConflicts(items: readonly DragItem[]): Set<string> {
  const conflicted = new Set<string>();
  const sorted = items.slice().sort((left, right) => left.localStartTime.localeCompare(right.localStartTime));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].localStartTime < sorted[i].localEndTime) {
        conflicted.add(sorted[i].id);
        conflicted.add(sorted[j].id);
      }
    }
  }
  return conflicted;
}

function formatHour(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const suffix = hour < 12 ? "AM" : "PM";
  return (hour % 12 === 0 ? 12 : hour % 12) + " " + suffix;
}

export function TimelinePane({ tripId, startDate, endDate, revision }: {
  tripId: string;
  startDate: string;
  endDate: string;
  revision: number;
}) {
  const drag = useDragCommit(tripId, revision);
  const { items, loading, loadError, commitDrag, commitSchedule, commitUnschedule } = drag;
  const { commitResize, commitUnlock } = useResizeCommit(drag);

  const dates = useMemo(() => tripDates(startDate, endDate), [startDate, endDate]);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [announcement, setAnnouncement] = useState("");
  const [candidates, setCandidates] = useState<PoolCandidate[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PoolCandidate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ candidate: PoolCandidate; startMinute: number } | null>(null);
  const [dropGuide, setDropGuide] = useState<DropGuide | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Scroll position is remembered per date, so switching days and coming back does not silently
  // dump the traveler at a different hour than they left.
  const scrollByDate = useRef(new Map<string, number>());
  const previousDate = useRef(selectedDate);

  useEffect(() => {
    if (!dates.includes(selectedDate)) setSelectedDate(dates[0]);
  }, [dates, selectedDate]);

  const byDate = useMemo(() => {
    const map = new Map<string, DragItem[]>();
    for (const date of dates) map.set(date, []);
    const unverified = new Set(candidates.filter((candidate) => candidate.openingStatus.kind === "unknown" && candidate.poiId).map((candidate) => candidate.poiId as string));
    for (const item of items) {
      const annotated: DragItem = { ...item, hoursUnverified: Boolean(item.poiId && unverified.has(item.poiId)) };
      map.set(item.localDate, [...(map.get(item.localDate) ?? []), annotated]);
    }
    for (const list of map.values()) list.sort((left, right) => left.localStartTime.localeCompare(right.localStartTime));
    return map;
  }, [items, dates, candidates]);

  const dayItems = useMemo(() => byDate.get(selectedDate) ?? [], [byDate, selectedDate]);
  const conflictedIds = useMemo(() => detectDayConflicts(dayItems), [dayItems]);
  const scheduledCountByDate = useMemo(
    () => new Map([...byDate].map(([date, list]) => [date, list.length])),
    [byDate],
  );

  // The pool's opening-status depends on which date is selected, so it refetches per date.
  useEffect(() => {
    let cancelled = false;
    setPoolLoading(true);
    setPoolError(null);
    fetch(`/api/trips/${encodeURIComponent(tripId)}/poi-choices?date=${selectedDate}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Unable to load places.");
        return data as { candidates: PoolCandidate[] };
      })
      .then((data) => { if (!cancelled) setCandidates(data.candidates); })
      .catch((cause) => { if (!cancelled) setPoolError(cause instanceof Error ? cause.message : "Unable to load places."); })
      .finally(() => { if (!cancelled) setPoolLoading(false); });
    return () => { cancelled = true; };
  }, [tripId, selectedDate]);

  // Restore the incoming day's scroll, or the default waking hour. Applied twice: once immediately
  // and once after the next frame, because on first paint the track can still be shorter than its
  // final height, and the browser silently clamps a scrollTop that exceeds the current scrollHeight.
  useEffect(() => {
    if (loading) return;
    if (previousDate.current !== selectedDate) previousDate.current = selectedDate;
    const target = scrollByDate.current.get(selectedDate) ?? minutesToPixels(DEFAULT_SCROLL_HOUR * 60, PX_PER_MINUTE);
    const apply = () => {
      if (viewportRef.current) viewportRef.current.scrollTop = target;
    };
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [selectedDate, loading]);

  const rememberScroll = useCallback(() => {
    if (viewportRef.current) scrollByDate.current.set(selectedDate, viewportRef.current.scrollTop);
  }, [selectedDate]);

  const schedule = useCallback(async (candidate: PoolCandidate, startMinute: number) => {
    if (!candidate.poiId) {
      setNotice("Only curated places can be scheduled yet.");
      return;
    }
    const feasibility = evaluateDrop(candidate.openingStatus, startMinute, candidate.defaultDurationMinutes);
    if (!feasibility.droppable) {
      setNotice(feasibility.reason);
      return;
    }
    const result = await commitSchedule(
      candidate.poiId, selectedDate, minutesToTime(startMinute), candidate.defaultDurationMinutes,
    );
    if (!result.ok) setNotice(result.reason);
    else setNotice(feasibility.warning ?? null);
  }, [commitSchedule, selectedDate]);

  const requestSchedule = useCallback((candidate: PoolCandidate, startMinute: number) => {
    // A repeat visit is legitimate, but it must be deliberate rather than an accidental second drop.
    const alreadyScheduled = items.some((item) => item.poiId && item.poiId === candidate.poiId);
    if (alreadyScheduled) {
      setDuplicate({ candidate, startMinute });
      return;
    }
    void schedule(candidate, startMinute);
  }, [items, schedule]);

  if (loading) return <p className="inline-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading itinerary...</p>;
  if (loadError) return <p className="error-notice" role="alert"><AlertCircle aria-hidden="true" /><span>{loadError}</span></p>;

  const ticks: number[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 60) ticks.push(minute);

  return <div className="timeline-pane" aria-label="Day builder">
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

    <DateSelector dates={dates} selectedDate={selectedDate} onSelect={setSelectedDate} scheduledCountByDate={scheduledCountByDate} />

    {notice && (
      <p className="cal-notice" role="status">
        {notice}
        <button type="button" className="cal-notice-dismiss" onClick={() => setNotice(null)}>Dismiss</button>
      </p>
    )}

    {duplicate && (
      <div className="cal-notice" role="alertdialog" aria-label="Confirm repeat visit">
        <span>{duplicate.candidate.name} is already on this trip. Add another visit?</span>
        <button type="button" onClick={() => { const pending = duplicate; setDuplicate(null); void schedule(pending.candidate, pending.startMinute); }}>Add anyway</button>
        <button type="button" onClick={() => setDuplicate(null)}>Cancel</button>
      </div>
    )}

    <div className="cal-builder">
      <PoiChoicePool
        candidates={candidates}
        loading={poolLoading}
        error={poolError}
        onOpenDetails={setDetail}
        onSchedule={(candidate) => {
          // Keyboard/click path: place at the first feasible time rather than requiring a drag.
          const firstOpen = candidate.openingStatus.kind === "open" ? candidate.openingStatus.intervals[0]?.startMinute : undefined;
          requestSchedule(candidate, firstOpen ?? DEFAULT_SCROLL_HOUR * 60);
        }}
        onUnscheduleDrop={(itemId) => void commitUnschedule(itemId)}
        poolDropActive
        onDragStateChange={(candidate) => setDropGuide(candidate === null ? null : {
          candidateKey: candidate.key,
          durationMinutes: candidate.defaultDurationMinutes,
          openIntervals: candidate.openingStatus.kind === "open" ? candidate.openingStatus.intervals : [],
          hoursKnown: candidate.openingStatus.kind === "open",
        })}
      />

      <div className="cal-viewport" ref={viewportRef} onScroll={rememberScroll}>
        <div className="cal-body" style={{ height: TRACK_HEIGHT_PX }}>
          <div className="cal-ruler">
            {ticks.map((minute) => (
              <span key={minute} className="cal-tick" style={{ top: minutesToPixels(minute, PX_PER_MINUTE) }}>{formatHour(minute)}</span>
            ))}
          </div>
          <DayColumn
            date={selectedDate}
            items={dayItems}
            conflictedIds={conflictedIds}
            pxPerMinute={PX_PER_MINUTE}
            trackHeightPx={TRACK_HEIGHT_PX}
            dropGuide={dropGuide}
            onMove={(itemId, newDate, newStartTime) => void commitDrag(itemId, newDate, newStartTime)}
            onResize={(itemId, newStartTime, durationMinutes) => void commitResize(itemId, newStartTime, durationMinutes)}
            onUnlock={(itemId) => void commitUnlock(itemId)}
            onUnschedule={(itemId) => void commitUnschedule(itemId)}
            onPoolDrop={(candidateKey, startMinute) => {
              const candidate = candidates.find((entry) => entry.key === candidateKey);
              if (candidate) requestSchedule(candidate, startMinute);
              setDropGuide(null);
            }}
            announce={setAnnouncement}
          />
        </div>
      </div>
    </div>

    {detail && <PoiDetailSheet candidate={detail} selectedDate={selectedDate} onClose={() => setDetail(null)} />}
  </div>;
}
