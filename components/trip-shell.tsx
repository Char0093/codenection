"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The one shared selected-trip surface (spec §2.3): Chat is the default, Plan and Timeline
// live in the same nav and unlock once the trip has valid dates, and every screen keeps a
// visible route back to the group list.
const ITEMS = [
  { key: "chat", label: "Chat", needsReady: false },
  { key: "plan", label: "Plan", needsReady: true },
  { key: "timeline", label: "Timeline", needsReady: true },
  { key: "entry", label: "Your prefs", needsReady: false },
] as const;

export function TripShell({ tripId, tripName, ready, children }: {
  tripId: string;
  tripName: string;
  ready: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <main className="app-shell trip-shell">
      <div className="section-heading">
        <div><h1>{tripName}</h1></div>
        <Link className="secondary-button" href="/chats">All trip groups</Link>
      </div>
      <nav className="trip-nav" aria-label="Trip sections">
        {ITEMS.map((item) => {
          const href = `/trips/${tripId}/${item.key}`;
          if (item.needsReady && !ready) {
            return (
              <span key={item.key} className="trip-nav-item" aria-disabled="true"
                title="Add trip dates to unlock planning">
                {item.label}
              </span>
            );
          }
          return (
            <Link key={item.key} href={href} className="trip-nav-item"
              aria-current={pathname === href ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="workspace-main">{children}</div>
    </main>
  );
}
