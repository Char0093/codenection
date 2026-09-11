"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bell, MapPin, Plus, Search, Sparkles, UserRound } from "lucide-react";
import { budgetTiers } from "@/lib/domain/trip";
import { TRIP_MODES, TRIP_MODE_LABELS, type TripMode } from "@/lib/domain/trip";
import type { BudgetTier } from "@/lib/domain/trip";
import type { ChatHomeTrip } from "@/lib/domain/chat-home";

// Chat-group home (spec §2.3): membership-scoped list + an organizer create form
// (destination + trip style + dates OR a rough length; optional proposed budget / split).
//
// Presented as a trip-group dashboard: a hero panel (greeting, at-a-glance counts, search +
// create) above a card grid of trip groups, in the same editorial/monochrome system as the
// rest of the shell (globals.css "hub-*" rules). The data contract, the create-form state and
// the POST /api/chats handler are unchanged from the earlier Messages-list build -- only the
// markup and class names moved.

function timeframeSummary(trip: ChatHomeTrip): string {
  if (trip.startDate && trip.endDate) return `${trip.destinationName ?? "Somewhere"} · ${trip.startDate} → ${trip.endDate}`;
  if (trip.plannedDurationDays) return `${trip.destinationName ?? "Somewhere"} · ${trip.plannedDurationDays}-day trip`;
  return `${trip.destinationName ?? "Somewhere"} · dates to be set`;
}

/**
 * Messages-style relative stamp for a trip card's trailing edge: clock time today,
 * "Yesterday", weekday within the last week, else a short date. Locale-formatted, never a
 * hand-rolled month table.
 */
function rowTimestamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.floor((startOfToday.getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86_400_000);
  if (dayDiff <= 0) return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return at.toLocaleDateString(undefined, { weekday: "short" });
  return at.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
}

/** First token of the account's email local-part, capitalised -- "mei.tan@…" -> "Mei". */
function greetingName(email?: string | null): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._+-]/)[0] ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000);
}

/** Soonest upcoming departure among "ready" trips, as a short label for the hero stat. */
function nextDepartureLabel(trips: ChatHomeTrip[]): string {
  const upcoming = trips
    .filter((trip) => trip.status === "ready" && trip.startDate)
    .map((trip) => ({ trip, days: daysUntil(trip.startDate as string) }))
    .filter((entry) => entry.days >= 0)
    .sort((a, b) => a.days - b.days)[0];
  if (!upcoming) return "—";
  if (upcoming.days === 0) return "Today";
  if (upcoming.days === 1) return "Tomorrow";
  return `${upcoming.days}d`;
}

export function ChatHomeView({ trips, accountEmail }: { trips: ChatHomeTrip[]; accountEmail?: string | null }) {
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");

  // Filters the rows already in memory -- no request, no change to what the server sent.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return trips;
    return trips.filter((trip) =>
      trip.name.toLowerCase().includes(needle)
      || (trip.destinationName ?? "").toLowerCase().includes(needle)
      || (trip.latestMessage?.preview ?? "").toLowerCase().includes(needle));
  }, [trips, query]);

  const readyCount = useMemo(() => trips.filter((trip) => trip.status === "ready").length, [trips]);
  const departureLabel = useMemo(() => nextDepartureLabel(trips), [trips]);
  const name = greetingName(accountEmail);

  return (
    <div className="hub-screen">
      <div className="hub-topbar">
        <div className="msg-topbar-actions">
          <button type="button" className="msg-topbar-icon" aria-label="Notifications">
            <Bell size={17} aria-hidden="true" />
          </button>
          {accountEmail && (
            <Link href="/settings" className="msg-user-chip">
              <span className="msg-user-avatar">{accountEmail.slice(0, 1).toUpperCase()}</span>
              <span className="msg-user-name">{accountEmail}</span>
            </Link>
          )}
        </div>
      </div>

      <section className="hub-hero">
        <div className="hub-hero-glow" aria-hidden="true" />
        <div className="hub-hero-row">
          <span className="hub-hero-eyebrow"><Sparkles size={12} aria-hidden="true" />Trip groups</span>
          <div className="hub-hero-stats" role="list">
            <div className="hub-stat" role="listitem">
              <strong>{trips.length}</strong>
              <span>Trip group{trips.length === 1 ? "" : "s"}</span>
            </div>
            <div className="hub-stat" role="listitem">
              <strong>{readyCount}</strong>
              <span>Ready to go</span>
            </div>
            <div className="hub-stat" role="listitem">
              <strong>{departureLabel}</strong>
              <span>Next departure</span>
            </div>
          </div>
        </div>
        <h1 className="hub-hero-title">{name ? `Welcome back, ${name}` : "Welcome back"}</h1>
        <p className="hub-hero-sub">
          Every trip lives in its own group chat — plan, split and settle it together, in one place.
        </p>

        {!showForm && (
          trips.length > 0 ? (
            <div className="hub-hero-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your trip groups"
                aria-label="Search trip groups"
              />
              <button type="button" className="primary-button hub-hero-cta" onClick={() => setShowForm(true)}>
                <Plus size={16} aria-hidden="true" />
                <span>New trip group</span>
              </button>
            </div>
          ) : (
            <button type="button" className="primary-button hub-hero-cta" onClick={() => setShowForm(true)}>
              <Plus size={16} aria-hidden="true" />
              <span>Create your first trip group</span>
            </button>
          )
        )}
      </section>

      {!showForm && (
        <section className="hub-quick-actions" aria-label="Quick actions">
          <button type="button" className="hub-quick-card" onClick={() => setShowForm(true)}>
            <span className="hub-quick-icon"><Plus aria-hidden="true" /></span>
            <span className="hub-quick-text">
              <strong>New trip group</strong>
              <span>Pick a destination, invite your group</span>
            </span>
            <ArrowRight className="hub-quick-arrow" aria-hidden="true" />
          </button>
          <Link href="/settings" className="hub-quick-card">
            <span className="hub-quick-icon"><UserRound aria-hidden="true" /></span>
            <span className="hub-quick-text">
              <strong>Your Travel DNA</strong>
              <span>Diet, access needs &amp; pace</span>
            </span>
            <ArrowRight className="hub-quick-arrow" aria-hidden="true" />
          </Link>
        </section>
      )}

      {showForm && (
        <section className="hub-form-card">
          <div className="hub-form-head">
            <h2>New trip group</h2>
            <p className="field-hint">Add a destination and rough dates — you can invite people once it&apos;s created.</p>
          </div>
          <CreateForm onCancel={() => setShowForm(false)} />
        </section>
      )}

      {!showForm && trips.length === 0 && (
        <div className="msg-empty hub-empty">
          <p>You have no trip groups yet. Start one and invite people when you are ready.</p>
        </div>
      )}

      {!showForm && trips.length > 0 && (
        <section className="hub-trips">
          <div className="hub-trips-head">
            <h2>Your trip groups</h2>
          </div>

          {visible.length === 0 ? (
            <p className="msg-no-results">No trip groups match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <div className="hub-trip-grid">
              {visible.map((trip) => {
                const unread = trip.unread ?? 0;
                return (
                  <Link key={trip.id} href={`/trips/${trip.id}/chat`} className="hub-trip-card">
                    <div className="hub-trip-card-top">
                      <span className="hub-trip-badge" data-status={trip.status}>
                        {trip.status === "ready" ? "Ready" : "Draft"}
                      </span>
                      {unread > 0 && <span className="msg-row-badge" aria-label={`${unread} unread`}>{unread}</span>}
                    </div>
                    <h3 className="hub-trip-name">{trip.name}</h3>
                    <p className="hub-trip-dest">
                      <MapPin size={13} aria-hidden="true" />
                      <span>
                        {timeframeSummary(trip)}
                        {trip.status === "draft" && " · Planning locked until dates are set"}
                      </span>
                    </p>
                    <p className="hub-trip-preview">
                      {trip.latestMessage ? trip.latestMessage.preview : "No messages yet"}
                    </p>
                    <div className="hub-trip-foot">
                      <span className="hub-trip-avatars" aria-label={`${trip.memberCount} members`}>
                        {trip.memberAvatars.slice(0, 3).map((avatar) => (
                          <span key={avatar.id} className="hub-trip-avatar" style={{ background: avatar.color }} title={avatar.displayName}>
                            {avatar.displayName.slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                      </span>
                      {trip.latestMessage && (
                        <time className="hub-trip-time" dateTime={trip.latestMessage.at}>
                          {rowTimestamp(trip.latestMessage.at)}
                        </time>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CreateForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [tripMode, setTripMode] = useState<TripMode | "">("");
  const [timeframe, setTimeframe] = useState<"dates" | "length">("dates");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [proposedBudgetTier, setProposedBudgetTier] = useState<BudgetTier | "">("");
  const [splitAllowed, setSplitAllowed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeframeReady = timeframe === "dates" ? Boolean(startDate && endDate) : Boolean(durationDays);
  const canSubmit = Boolean(name.trim() && destinationName.trim() && tripMode) && timeframeReady && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      destinationName: destinationName.trim(),
      tripMode,
      proposedBudgetTier: proposedBudgetTier || null,
      splitAllowed,
    };
    if (timeframe === "dates") { body.startDate = startDate; body.endDate = endDate; }
    else { body.plannedDurationDays = Number(durationDays); }

    try {
      const response = await fetch("/api/chats", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.tripId) { router.push(`/trips/${data.tripId}/chat`); return; }
      setError(data?.error ?? `Could not create the trip group (${response.status}).`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="chat-home-form" onSubmit={submit}>
      <label>
        Group name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
      </label>
      <label>
        Destination
        <input value={destinationName} onChange={(event) => setDestinationName(event.target.value)} maxLength={120} required />
      </label>
      <label>
        Trip style
        <select value={tripMode} onChange={(event) => setTripMode(event.target.value as TripMode)} required>
          <option value="" disabled>Choose a style…</option>
          {TRIP_MODES.map((mode) => (
            <option key={mode} value={mode}>{TRIP_MODE_LABELS[mode]}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>When</legend>
        <label>
          <input type="radio" name="timeframe" checked={timeframe === "dates"} onChange={() => setTimeframe("dates")} />
          I have dates
        </label>
        <label>
          <input type="radio" name="timeframe" checked={timeframe === "length"} onChange={() => setTimeframe("length")} />
          Just a rough length
        </label>
        {timeframe === "dates" ? (
          <div className="chat-home-dates">
            <label>
              Start date
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              End date
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>
        ) : (
          <label>
            How many days
            <input type="number" min={1} max={14} value={durationDays}
              onChange={(event) => setDurationDays(event.target.value)} />
          </label>
        )}
      </fieldset>

      <label>
        Proposed per-person budget (optional)
        <select value={proposedBudgetTier} onChange={(event) => setProposedBudgetTier(event.target.value as BudgetTier)}>
          <option value="">No preference</option>
          {budgetTiers.map((tier) => (
            <option key={tier.value} value={tier.value}>{tier.label}</option>
          ))}
        </select>
      </label>
      <label className="onboarding-quick">
        <input type="checkbox" checked={splitAllowed} onChange={(event) => setSplitAllowed(event.target.checked)} />
        Allow splitting into subgroups during the trip
      </label>

      {error && <p className="error-notice" role="alert"><span>{error}</span></p>}

      <div className="onboarding-nav">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="submit" className="primary-button" disabled={!canSubmit}>Create trip group</button>
      </div>
    </form>
  );
}
