"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SquarePen } from "lucide-react";
import { budgetTiers } from "@/lib/domain/trip";
import { TRIP_MODES, TRIP_MODE_LABELS, type TripMode } from "@/lib/domain/trip";
import type { BudgetTier } from "@/lib/domain/trip";
import type { ChatHomeTrip } from "@/lib/domain/chat-home";

// Chat-group home (spec §2.3): membership-scoped list + an organizer create form
// (destination + trip style + dates OR a rough length; optional proposed budget / split).
//
// Presented as the iOS Messages conversation list (ios-chat-design.md §4 "Conversation List"):
// large title, search field, then 60pt rows of avatar / name / preview / timestamp. The data
// contract, the create-form state and the POST /api/chats handler are unchanged -- only the
// markup and class names moved.

function timeframeSummary(trip: ChatHomeTrip): string {
  if (trip.startDate && trip.endDate) return `${trip.destinationName ?? "Somewhere"} · ${trip.startDate} → ${trip.endDate}`;
  if (trip.plannedDurationDays) return `${trip.destinationName ?? "Somewhere"} · ${trip.plannedDurationDays}-day trip`;
  return `${trip.destinationName ?? "Somewhere"} · dates to be set`;
}

/**
 * Messages-style relative stamp for the trailing edge of a row: clock time today, "Yesterday",
 * weekday within the last week, else a short date. Locale-formatted, never a hand-rolled
 * month table.
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

export function ChatHomeView({ trips }: { trips: ChatHomeTrip[] }) {
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

  return (
    <div className="msg-list-screen">
      <div className="msg-list-head">
        <h1 className="msg-large-title">Messages</h1>
        {trips.length > 0 && !showForm && (
          <button type="button" className="msg-compose-button" onClick={() => setShowForm(true)} title="New trip group">
            <SquarePen size={19} aria-hidden="true" />
            <span className="sr-only">New trip group</span>
          </button>
        )}
      </div>

      {trips.length > 0 && !showForm && (
        <div className="msg-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search trip groups"
          />
        </div>
      )}

      {trips.length === 0 && !showForm && (
        <div className="msg-empty">
          <p>You have no trip groups yet. Start one and invite people when you are ready.</p>
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            Create your first trip group
          </button>
        </div>
      )}

      {showForm && <CreateForm onCancel={() => setShowForm(false)} />}

      {trips.length > 0 && !showForm && visible.length === 0 && (
        <p className="msg-no-results">No trip groups match “{query.trim()}”.</p>
      )}

      {visible.length > 0 && !showForm && (
        <ul className="msg-rows">
          {visible.map((trip) => {
            // `unread` is null until the unread infrastructure lands (see chat-home.ts), so the
            // badge simply does not render rather than showing a fabricated count.
            const unread = trip.unread ?? 0;
            return (
              <li key={trip.id} className="msg-row" data-unread={unread > 0 ? "true" : "false"}>
                <Link href={`/trips/${trip.id}/chat`} className="chat-home-link msg-row-link">
                  <span className="msg-row-dot" aria-hidden="true" />
                  <span className="msg-row-avatars" aria-label={`${trip.memberCount} members`}>
                    {trip.memberAvatars.slice(0, 3).map((avatar) => (
                      <span key={avatar.id} className="msg-row-avatar" style={{ background: avatar.color }} title={avatar.displayName}>
                        {avatar.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                  </span>
                  <span className="msg-row-main">
                    <span className="msg-row-top">
                      <span className="msg-row-name">{trip.name}</span>
                      {trip.latestMessage && (
                        <time className="msg-row-time" dateTime={trip.latestMessage.at}>
                          {rowTimestamp(trip.latestMessage.at)}
                        </time>
                      )}
                    </span>
                    <span className="msg-row-preview">
                      {trip.latestMessage ? trip.latestMessage.preview : "No messages yet"}
                    </span>
                    <span className="msg-row-meta">
                      {timeframeSummary(trip)}
                      {trip.status === "draft" && " · Planning locked until dates are set"}
                    </span>
                  </span>
                  {unread > 0 && <span className="msg-row-badge" aria-label={`${unread} unread`}>{unread}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
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
