"use client";

import React, { useEffect, useRef } from "react";

/**
 * Tapbacks (ios-chat-design.md §4): the six-glyph reaction strip on long-press, and the chip
 * that docks over the bubble's owner-near top corner once one is chosen.
 *
 * PERSISTENCE: reactions currently live in the calling component's React state only. There is
 * no reactions table, so a tapback does not survive a reload and is not visible to other
 * members. `onReact` is the seam: point it at a repository write plus a realtime broadcast and
 * the UI needs no change. Nothing here fabricates a reaction that another member did not make.
 */

export const TAPBACKS = ["heart", "thumbsUp", "thumbsDown", "haha", "emphasize", "question"] as const;
export type Tapback = (typeof TAPBACKS)[number];

/** Glyphs are the reaction's content, not decoration, so they are labelled rather than hidden. */
const GLYPH: Record<Tapback, { symbol: string; label: string }> = {
  heart: { symbol: "♥", label: "Heart" },
  thumbsUp: { symbol: "\u{1F44D}", label: "Thumbs up" },
  thumbsDown: { symbol: "\u{1F44E}", label: "Thumbs down" },
  haha: { symbol: "Ha", label: "Ha ha" },
  emphasize: { symbol: "‼", label: "Emphasise" },
  question: { symbol: "?", label: "Question mark" },
};

export function tapbackLabel(tapback: Tapback): string {
  return GLYPH[tapback].label;
}

/** The docked chip overlapping the bubble corner nearest its owner. */
export function TapbackChip({ tapback }: { tapback: Tapback }) {
  const { symbol, label } = GLYPH[tapback];
  return (
    <span className="tapback-chip" data-tapback={tapback}>
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The floating capsule of six glyphs. Dismisses on Escape, on a click elsewhere, and when
 * focus leaves the strip, so it can never be left stranded over the thread.
 */
export function TapbackStrip({ current, onPick, onDismiss }: {
  current: Tapback | null;
  onPick: (tapback: Tapback) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.stopPropagation(); onDismiss(); }
    }
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onDismiss]);

  return (
    <div className="tapback-strip" ref={ref} role="group" aria-label="React to this message">
      {TAPBACKS.map((tapback) => (
        <button
          key={tapback}
          type="button"
          className="tapback-glyph"
          data-selected={current === tapback ? "true" : "false"}
          aria-pressed={current === tapback}
          onClick={() => onPick(tapback)}
        >
          <span aria-hidden="true">{GLYPH[tapback].symbol}</span>
          <span className="sr-only">{GLYPH[tapback].label}</span>
        </button>
      ))}
    </div>
  );
}
