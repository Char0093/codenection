"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock, ChevronDown, Info, LayoutDashboard, ListChecks, LogOut, Luggage, Map as MapIcon,
  Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Split, UserRound,
  Wallet, X,
} from "lucide-react";
import { isPrototype } from "@/lib/prototype/config";
import { BrandMark } from "@/components/brand-mark";

type TripContext = { id: string; name: string; ready: boolean };
type SidebarTrip = { id: string; name: string };

// Trip-scoped items: only shown once a specific trip is open (see the `trip` prop below).
// Unlike Chat/Your prefs, the planning surfaces need a ready trip (valid destination + dates).
// `demoOnly` items have no non-prototype implementation yet, so they are hidden outside it
// rather than linking to a 404.
const TRIP_ITEMS = [
  { key: "chat", label: "Chat", needsReady: false, icon: MessageCircle, demoOnly: false },
  { key: "plan", label: "Plan", needsReady: true, icon: ListChecks, demoOnly: false },
  { key: "timeline", label: "Timeline", needsReady: true, icon: CalendarClock, demoOnly: false },
  { key: "map", label: "Map", needsReady: true, icon: MapIcon, demoOnly: true },
  { key: "jigsaw", label: "Split & merge", needsReady: true, icon: Split, demoOnly: true },
  { key: "budget", label: "Budget", needsReady: true, icon: Wallet, demoOnly: true },
  { key: "safety", label: "Food check", needsReady: true, icon: ShieldCheck, demoOnly: true },
  { key: "packing", label: "Packing", needsReady: true, icon: Luggage, demoOnly: true },
  { key: "entry", label: "Your prefs", needsReady: false, icon: UserRound, demoOnly: false },
] as const;

const WIDTH_KEY = "waypoint-sidebar-w";
const COLLAPSED_KEY = "waypoint-sidebar-collapsed";
const CHATROOM_OPEN_KEY = "waypoint-sidebar-chatroom-open";
const MIN_WIDTH = 224;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 272;

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

/**
 * The one persistent app shell: a sidebar alongside the page's own content. The sidebar always
 * carries the account-level items (Dashboard / Settings / Log out) and, only while a specific
 * trip is open, that trip's Chat/Plan/Timeline/Your prefs section above them. When the caller
 * passes `trips` (only the dashboard page does), a collapsible "Chatroom" section lists each
 * trip by name so its chat is reachable in one click; its open/closed state persists too.
 *
 * On desktop the rail is resizable (drag its right edge) and foldable (the toggle collapses it
 * to an icons-only strip); both preferences persist to localStorage. Under 900px it becomes an
 * off-canvas drawer opened from the slim mobile top bar -- see .app-sidebar/.mobile-topbar in
 * globals.css.
 */
export function AppShell({ trip, trips, accountEmail, children }: {
  trip?: TripContext | null;
  trips?: SidebarTrip[];
  accountEmail?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [chatroomOpen, setChatroomOpen] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Mobile has no persistent sidebar to read the section from (it's a hidden drawer), so the
  // slim top bar is the only "you are here" landmark on Plan/Timeline/Budget/etc. -- it needs
  // both the trip name and which section of it this is, not just the trip name alone.
  const section = trip ? TRIP_ITEMS.find((item) => pathname === `/trips/${trip.id}/${item.key}`) : null;
  const pageTitle = trip?.name ?? (pathname === "/chats" ? "Trip groups" : pathname === "/settings" ? "Settings" : "Waypoint");

  // Restore the saved rail size / fold state. localStorage is client-only, so this can't run
  // during render without a hydration mismatch -- same pattern as the theme toggle.
  useEffect(() => {
    try {
      const savedWidth = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 0) setWidth(clampWidth(savedWidth));
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
      const savedChatroomOpen = localStorage.getItem(CHATROOM_OPEN_KEY);
      if (savedChatroomOpen !== null) setChatroomOpen(savedChatroomOpen === "1");
    } catch {
      // Blocked storage: fall back to the defaults already in state.
    }
  }, []);

  // A route change means a nav link was just followed -- close the drawer behind it.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  function toggleChatroomOpen() {
    setChatroomOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(CHATROOM_OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  const onResizeMove = useCallback((event: PointerEvent) => {
    if (!dragRef.current) return;
    setWidth(clampWidth(dragRef.current.startWidth + (event.clientX - dragRef.current.startX)));
  }, []);

  const onResizeEnd = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
    setWidth((current) => {
      try { localStorage.setItem(WIDTH_KEY, String(current)); } catch { /* ignore */ }
      return current;
    });
  }, [onResizeMove]);

  function onResizeStart(event: React.PointerEvent) {
    if (collapsed) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeEnd);
  }

  useEffect(() => () => {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
  }, [onResizeMove, onResizeEnd]);

  return (
    <div className="shell">
      {isPrototype() && (
        <p className="demo-banner" role="status">
          <Info aria-hidden="true" />
          <span><strong>Demo mode</strong> — sample data only. Anything you change here resets on refresh.</span>
        </p>
      )}
      <div className="mobile-topbar">
        <button type="button" className="icon-button" aria-label="Open menu" aria-expanded={open}
          onClick={() => setOpen(true)}>
          <Menu aria-hidden="true" />
        </button>
        <span className="mobile-topbar-titles">
          <span className="mobile-topbar-title">{pageTitle}</span>
          {section && <span className="mobile-topbar-section">{section.label}</span>}
        </span>
      </div>
      <div className="shell-body">
        {open && (
          <button type="button" className="app-sidebar-backdrop" aria-label="Dismiss menu" onClick={() => setOpen(false)} />
        )}
        <aside
          className="app-sidebar"
          data-open={open ? "true" : "false"}
          data-collapsed={collapsed ? "true" : "false"}
          data-dragging={dragging ? "true" : "false"}
          style={{ ["--sidebar-w" as string]: `${width}px` }}
        >
          <div className="app-sidebar-head">
            <Link href="/chats" className="brand-block"><BrandMark size={26} /><strong>Waypoint</strong></Link>
            <button type="button" className="app-sidebar-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={collapsed} onClick={toggleCollapsed}>
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </button>
            <button type="button" className="icon-button app-sidebar-close" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>

          <nav className="app-sidebar-nav" aria-label="Trip groups">
            <Link href="/chats" className="app-sidebar-link" aria-current={pathname === "/chats" ? "page" : undefined}>
              <LayoutDashboard aria-hidden="true" /><span>Dashboard</span>
            </Link>
            {trips && trips.length > 0 && (
              <>
                <button type="button" className="app-sidebar-link app-sidebar-toggle"
                  aria-expanded={chatroomOpen} onClick={toggleChatroomOpen}>
                  <MessageCircle aria-hidden="true" /><span>Chatroom</span>
                  <ChevronDown className="app-sidebar-toggle-chevron" aria-hidden="true" />
                </button>
                {chatroomOpen && (
                  <nav className="app-sidebar-nav app-sidebar-subnav" aria-label="Your trip chats">
                    {trips.map((t) => {
                      const href = `/trips/${t.id}/chat`;
                      return (
                        <Link key={t.id} href={href} className="app-sidebar-link app-sidebar-sublink"
                          aria-current={pathname === href ? "page" : undefined} title={t.name}>
                          <MessageCircle aria-hidden="true" /><span>{t.name}</span>
                        </Link>
                      );
                    })}
                  </nav>
                )}
              </>
            )}
          </nav>

          {trip && (
            <>
              <p className="app-sidebar-heading">{trip.name}</p>
              <nav className="app-sidebar-nav" aria-label="Trip sections">
                {TRIP_ITEMS.filter((item) => !item.demoOnly || isPrototype()).map((item) => {
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
                      aria-current={pathname === href ? "page" : undefined} title={item.label}>
                      <Icon aria-hidden="true" /><span>{item.label}</span>
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

          <div
            className="app-sidebar-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={onResizeStart}
          />
        </aside>
        <main className="app-shell">{children}</main>
      </div>
    </div>
  );
}
