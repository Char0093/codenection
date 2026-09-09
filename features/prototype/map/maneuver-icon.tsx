"use client";

import React from "react";
import {
  ArrowUp, ArrowUpLeft, ArrowUpRight, CornerDownLeft, CornerDownRight,
  CornerUpLeft, CornerUpRight, Merge, MapPin, Navigation2, RotateCcw, RotateCw, Ship, Split, Undo2,
} from "lucide-react";

type Icon = typeof ArrowUp;

/** Google `maneuver` value → a directional glyph, Google/Waze style. */
const BY_MANEUVER: Record<string, Icon> = {
  "turn-left": CornerUpLeft,
  "turn-right": CornerUpRight,
  "turn-slight-left": ArrowUpLeft,
  "turn-slight-right": ArrowUpRight,
  "turn-sharp-left": CornerDownLeft,
  "turn-sharp-right": CornerDownRight,
  "keep-left": ArrowUpLeft,
  "keep-right": ArrowUpRight,
  "ramp-left": CornerUpLeft,
  "ramp-right": CornerUpRight,
  "fork-left": Split,
  "fork-right": Split,
  "merge": Merge,
  "straight": ArrowUp,
  "uturn-left": Undo2,
  "uturn-right": Undo2,
  "roundabout-left": RotateCcw,
  "roundabout-right": RotateCw,
  "ferry": Ship,
  "ferry-train": Ship,
};

/** Fall back to the words in the instruction when Google gives no `maneuver`. */
function fromText(text: string): Icon {
  const t = text.toLowerCase();
  if (/\bslight left\b/.test(t)) return ArrowUpLeft;
  if (/\bslight right\b/.test(t)) return ArrowUpRight;
  if (/\bu-?turn\b/.test(t)) return Undo2;
  if (/\bleft\b/.test(t)) return CornerUpLeft;
  if (/\bright\b/.test(t)) return CornerUpRight;
  if (/\b(head|continue|straight|toward)\b/.test(t)) return Navigation2;
  return ArrowUp;
}

export function ManeuverIcon({ maneuver, instruction, last, size = 15 }: {
  maneuver?: string;
  instruction: string;
  last?: boolean;
  size?: number;
}) {
  const Icon: Icon = last ? MapPin : (maneuver && BY_MANEUVER[maneuver]) || fromText(instruction);
  return (
    <span className={`maneuver-icon${last ? " maneuver-icon-dest" : ""}`} aria-hidden="true">
      <Icon size={size} strokeWidth={2.4} />
    </span>
  );
}
