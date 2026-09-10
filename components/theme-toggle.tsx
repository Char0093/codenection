"use client";

import React, { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

/**
 * Light / Dark / System appearance control.
 *
 * "System" is the default and stores nothing, so the prefers-color-scheme block in globals.css
 * stays in charge. An explicit choice writes <html data-theme> -- which every dark token is
 * mirrored under -- and persists it, so the inline bootstrap in app/layout.tsx can re-apply it
 * before first paint on the next load.
 *
 * Renders the "system" state until mounted: localStorage is unreadable on the server, so
 * committing to a value during SSR would produce markup that disagrees with the bootstrap
 * script's result.
 */

const STORAGE_KEY = "waypoint-theme";
type Choice = "light" | "dark" | "system";

const OPTIONS: { value: Choice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setChoice(stored);
    } catch {
      // Private mode or blocked storage: stay on "system". Not worth surfacing.
    }
  }, []);

  function select(next: Choice) {
    setChoice(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The theme still applies for this session; only persistence is lost.
    }
  }

  return (
    <div className="theme-toggle">
      <span className="theme-toggle-label" id="appearance-label">Appearance</span>
      <div className="theme-segmented" role="radiogroup" aria-labelledby="appearance-label">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mounted ? choice === value : value === "system"}
            className="theme-segment"
            data-active={mounted && choice === value ? "true" : "false"}
            onClick={() => select(value)}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
