"use client";

import React, { useRef } from "react";

/**
 * Task 3.4's date strip. Only one trip day is ever rendered on the timeline, so this is the sole
 * way to reach the others. Implemented as a proper tablist: arrow keys move between dates, Home/End
 * jump to the ends, and only the selected tab is in the tab order (the standard roving-tabindex
 * pattern), so the strip is fully usable without a pointer.
 */
export function DateSelector({ dates, selectedDate, onSelect, scheduledCountByDate }: {
  dates: readonly string[];
  selectedDate: string;
  onSelect: (date: string) => void;
  scheduledCountByDate: ReadonlyMap<string, number>;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  function focusDate(date: string) {
    onSelect(date);
    // Focus follows selection so the arrow-key user keeps their place on the strip.
    window.requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = dates.indexOf(selectedDate);
    if (index < 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (next >= 0 && next < dates.length) focusDate(dates[next]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusDate(dates[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusDate(dates[dates.length - 1]);
    }
  }

  return (
    <div className="cal-date-strip" role="tablist" aria-label="Trip days" ref={stripRef} onKeyDown={handleKeyDown}>
      {dates.map((date, index) => {
        const selected = date === selectedDate;
        const scheduled = scheduledCountByDate.get(date) ?? 0;
        return (
          <button
            key={date}
            type="button"
            role="tab"
            data-date={date}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="cal-date-tab"
            data-selected={selected ? "true" : undefined}
            onClick={() => onSelect(date)}
          >
            <span className="cal-date-tab-day">Day {index + 1}</span>
            <span className="cal-date-tab-date">{date}</span>
            <span className="cal-date-tab-count">
              {scheduled === 0 ? "Nothing planned" : `${scheduled} planned`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
