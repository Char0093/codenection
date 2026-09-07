"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { budgetTiers } from "@/lib/domain/trip";
import { TRIP_MODES, TRIP_MODE_LABELS, type TripMode } from "@/lib/domain/trip";
import type { BudgetTier } from "@/lib/domain/trip";
import type { ChatHomeTrip } from "@/lib/domain/chat-home";

// Chat-group home (spec §2.3): membership-scoped list + an organizer create form
// (destination + trip style + dates OR a rough length; optional proposed budget / split).

function timeframeSummary(trip: ChatHomeTrip): string {
  if (trip.startDate && trip.endDate) return `${trip.destinationName ?? "Somewhere"} · ${trip.startDate} → ${trip.endDate}`;
  if (trip.plannedDurationDays) return `${trip.destinationName ?? "Somewhere"} · ${trip.plannedDurationDays}-day trip`;
  return `${trip.destinationName ?? "Somewhere"} · dates to be set`;
}

export function ChatHomeView({ trips }: { trips: ChatHomeTrip[] }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <main className="app-shell">
      <div className="section-heading">
        <div>
          <h1>Your trip groups</h1>
          <p className="field-hint">Each group is one trip — its chat, its plan, its members.</p>
        </div>
        {trips.length > 0 && !showForm && (
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            New trip group
          </button>
        )}
      </div>

      {trips.length === 0 && !showForm && (
        <div className="inline-notice">
          <span>You have no trip groups yet. Start one and invite people when you are ready.</span>
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            Create your first trip group
          </button>
        </div>
      )}

      {showForm && <CreateForm onCancel={() => setShowForm(false)} />}

      {trips.length > 0 && (
        <ul className="chat-home-list">
          {trips.map((trip) => (
            <li key={trip.id} className="chat-home-row">
              <Link href={`/trips/${trip.id}/chat`} className="chat-home-link">
                <span className="chat-home-name">{trip.name}</span>
                <span className="field-hint">{timeframeSummary(trip)}</span>
                <span className="chat-home-preview">{trip.latestMessage ? trip.latestMessage.preview : "No messages yet"}</span>
                <span className="chat-home-avatars" aria-label={`${trip.memberCount} members`}>
                  {trip.memberAvatars.map((avatar) => (
                    <span key={avatar.id} className="chat-home-avatar" style={{ background: avatar.color }} title={avatar.displayName}>
                      {avatar.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                </span>
              </Link>
              {trip.status === "draft" && (
                <p className="field-hint">Planning locked until dates are set.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
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
