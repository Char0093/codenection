"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, CalendarClock, ListChecks, MessageCircle, UserRound } from "lucide-react";

// The one shared selected-trip surface (spec §2.3): Chat is the default, Plan and Timeline
// live in the same nav and unlock once the trip has valid dates, and every screen keeps a
// visible route back to the group list. The icon rides along on every item so the same nav
// can read as an underlined tab row on desktop and collapse into a bottom tab bar on a phone
// without changing markup between breakpoints -- see .trip-nav in globals.css.
const ITEMS = [
  { key: "chat", label: "Chat", needsReady: false, icon: MessageCircle },
  { key: "plan", label: "Plan", needsReady: true, icon: ListChecks },
  { key: "timeline", label: "Timeline", needsReady: true, icon: CalendarClock },
  { key: "entry", label: "Your prefs", needsReady: false, icon: UserRound },
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
        <Link className="secondary-button" href="/chats"><ArrowLeft aria-hidden="true" />All trip groups</Link>
      </div>
      <nav className="trip-nav" aria-label="Trip sections">
        {ITEMS.map((item) => {
          const href = `/trips/${tripId}/${item.key}`;
          const Icon = item.icon;
          if (item.needsReady && !ready) {
            return (
              <span key={item.key} className="trip-nav-item" aria-disabled="true"
                title="Add trip dates to unlock planning">
                <Icon className="trip-nav-icon" aria-hidden="true" />{item.label}
              </span>
            );
          }
          return (
            <Link key={item.key} href={href} className="trip-nav-item"
              aria-current={pathname === href ? "page" : undefined}>
              <Icon className="trip-nav-icon" aria-hidden="true" />{item.label}
            </Link>
          );
        })}
      </nav>
      <div className="workspace-main">{children}</div>
    </main>
  );
}
