"use client";

import React, { useId } from "react";

/**
 * Checkbox whose tick draws itself in with a single animated stroke (see `.container` / `.path`
 * / `@keyframes hi` in globals.css) — a second, more playful style than <AnimatedCheckbox>'s
 * box+tick pair. The native input stays in the DOM (just visually hidden), so this remains a
 * real form control: focus, keyboard activation, and `name`/`value` all work as normal.
 *
 * `pathLength={100}` normalises stroke-dasharray/dashoffset math to a flat 0–100 scale, so the
 * CSS doesn't need to know this path's real on-screen length.
 */
export function DrawCheckbox({
  checked,
  onChange,
  label,
  disabled,
  name,
  value,
  id: providedId,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  name?: string;
  value?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <label htmlFor={id} className="container" data-disabled={disabled ? "true" : undefined}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path className="path" pathLength={100} d="M18 34 L28 45 L48 19" fill="none" />
      </svg>
      {label != null && <span className="draw-checkbox-label">{label}</span>}
    </label>
  );
}
