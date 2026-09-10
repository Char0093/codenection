"use client";

import React, { useId } from "react";

/**
 * Checkbox with the "draw-on" SVG animation from the mockup spec: the rounded box outline and
 * the tick each animate their stroke-dashoffset to 0 when checked (see `.checkbox-wrapper` in
 * globals.css). The native input is visually hidden but kept in the DOM, so it stays a real
 * form control -- focus, keyboard, `name`/`value`, and change events are unchanged.
 */
export function AnimatedCheckbox({
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
    <span className="checkbox-wrapper">
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
      <label htmlFor={id} className="terms-label">
        <svg className="checkbox-svg" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
          <rect className="checkbox-box" x="2.5" y="2.5" width="25" height="25" rx="7" ry="7" />
          <path className="checkbox-tick" d="M8 15.5 L13 20.5 L22.5 9.5" fill="none" />
        </svg>
        {label != null && <span className="label-text">{label}</span>}
      </label>
    </span>
  );
}
