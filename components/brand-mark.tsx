import React from "react";

/**
 * The Waypoint mark: a solid ink disc with the surface colour punched through the centre
 * (a target / dropped-pin motif). Inherits `currentColor` for the disc so it reads correctly
 * on the light sidebar, the login sheet, and dark mode alike.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <circle cx="12" cy="12" r="4" fill="var(--surface)" />
    </svg>
  );
}
