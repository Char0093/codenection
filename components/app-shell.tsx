"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock, Compass, ListChecks, LogOut, Menu, MessageCircle,
  Settings, Users, UserRound, X,
} from "lucide-react";

type TripContext = { id: string; name: string; ready: boolean };

// Trip-scoped items: only shown once a specific trip is open (see the `trip` prop below).
// Unlike Chat/Your prefs, Plan and Timeline need a ready trip (valid destination + dates).
const TRIP_ITEMS = [
  { key: "chat", label: "Chat", needsReady: false, icon: MessageCircle },
  { key: "plan", label: "Plan", needsReady: true, icon: ListChecks },
  { key: "timeline", label: "Timeline", needsReady: true, icon: CalendarClock },
  { key: "entry", label: "Your prefs", needsReady: false, icon: UserRound },
] as const;

/**
 * The one persistent app shell: a sidebar alongside the page's own content. The sidebar always
 * carries the account-level items (All trip groups / Settings / Log out) and, only while a
 * specific trip is open, that trip's Chat/Plan/Timeline/Your prefs section above them --
 * replacing the old per-trip TripShell tab row, which lived only inside a trip. Collapses into
 * an off-canvas drawer under 900px (opened from the slim mobile top bar) so a phone gets a
 * hamburger toggle instead of a permanent rail -- see .app-sidebar/.mobile-topbar in
 * globals.css.
 */
export function AppShell({ trip, accountEmail, children }: {
  trip?: TripContext | null;
  accountEmail?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A route change means a nav link was just followed -- close the drawer behind it.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="shell">
      <div className="mobile-topbar">
        <button type="button" className="icon-button" aria-label="Open menu" aria-expanded={open}
          onClick={() => setOpen(true)}>
          <Menu aria-hidden="true" />
        </button>
        <span className="mobile-topbar-title">{trip?.name ?? "Waypoint"}</span>
      </div>
      <div className="shell-body">
        {open && (
          <button type="button" className="app-sidebar-backdrop" aria-label="Dismiss menu" onClick={() => setOpen(false)} />
        )}
        <aside className="app-sidebar" data-open={open ? "true" : "false"}>
          <div className="app-sidebar-head">
            <Link href="/chats" className="brand-block"><Compass aria-hidden="true" /><strong>Waypoint</strong></Link>
            <button type="button" className="icon-button app-sidebar-close" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>

          <nav className="app-sidebar-nav" aria-label="Trip groups">
            <Link href="/chats" className="app-sidebar-link" aria-current={pathname === "/chats" ? "page" : undefined}>
              <Users aria-hidden="true" /><span>All trip groups</span>
            </Link>
          </nav>

          {trip && (
            <>
              <p className="app-sidebar-heading">{trip.name}</p>
              <nav className="app-sidebar-nav" aria-label="Trip sections">
                {TRIP_ITEMS.map((item) => {
                  const href = `/trips/${trip.id}/${item.key}`;
                  const Icon = item.icon;
                  if (item.needsReady && !trip.ready) {
                    return (
                      <span key={item.key} className="app-sidebar-link" aria-disabled="true"
                        title="Add trip dates to unlock planning">
                        <Icon aria-hidden="true" />{item.label}
                      </span>
                    );
                  }
                  return (
                    <Link key={item.key} href={href} className="app-sidebar-link"
                      aria-current={pathname === href ? "page" : undefined}>
                      <Icon aria-hidden="true" />{item.label}
                    </Link>
                  );
                })}
              </nav>
            </>
          )}

          <div className="app-sidebar-spacer" />

          <nav className="app-sidebar-nav" aria-label="Account">
            <Link href="/settings" className="app-sidebar-link" aria-current={pathname === "/settings" ? "page" : undefined}>
              <Settings aria-hidden="true" /><span>Settings</span>
            </Link>
            {accountEmail && <p className="app-sidebar-email">{accountEmail}</p>}
            <form action="/auth/signout" method="post">
              <button type="submit" className="app-sidebar-link app-sidebar-logout">
                <LogOut aria-hidden="true" /><span>Log out</span>
              </button>
            </form>
          </nav>
        </aside>
        <main className="app-shell">{children}</main>
      </div>
    </div>
  );
}
