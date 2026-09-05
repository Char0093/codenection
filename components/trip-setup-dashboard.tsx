"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, Compass, FileText, LoaderCircle, LogOut, Map as MapIcon, MessageSquare, Plus, RotateCcw, Save, Settings2, Sparkles, Users } from "lucide-react";
import { budgetTiers, paceLevels, validateTripDates, type TripInput } from "@/lib/domain/trip";
import type { ProposalRecord, TripRecord } from "@/lib/repositories/planning-repository";
import { GeminiProposalReview } from "@/components/gemini-proposal-review";
import { DietaryConstraintPicker } from "@/components/dietary-constraint-picker";
import type { DietaryFlag } from "@/lib/domain/constraints";
import { ChatPane } from "@/features/chat/chat-pane";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";

type View = "setup" | "plan" | "timeline" | "chat";
const TABS: { id: View; label: string; icon: typeof Settings2 }[] = [
  { id: "setup", label: "Trip Setup", icon: Settings2 },
  { id: "plan", label: "Plan", icon: FileText },
  { id: "timeline", label: "Timeline", icon: MapIcon },
  { id: "chat", label: "Chat", icon: MessageSquare },
];
type Operation = "loading" | "saving" | "generating" | "deciding" | null;
type TripDetail = {
  trip: TripRecord; proposals: ProposalRecord[]; dietaryFlags: DietaryFlag[];
  members: JigsawMember[]; selfMemberId: string | null;
};
const emptyInput: TripInput = { destinationName: "", startDate: "", endDate: "", budgetTier: "standard", pace: "balanced", notes: "" };

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

function inputFromTrip(trip: TripRecord): TripInput {
  return { destinationName: trip.destinationName, startDate: trip.startDate, endDate: trip.endDate,
    budgetTier: trip.budgetTier, pace: trip.pace, notes: trip.notes ?? "" };
}

async function request<T>(path: string, signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, signal, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(data?.error || `Request failed (${response.status}). Please try again.`, response.status);
  if (!data) throw new Error("The server returned an empty response. Please try again.");
  return data as T;
}

function setTripUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("trip", id);
  else url.searchParams.delete("trip");
  window.history.replaceState(null, "", url);
}

export function TripSetupDashboard({ email }: { email: string }) {
  const [view, setView] = useState<View>("setup");
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [input, setInput] = useState<TripInput>(emptyInput);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [dietaryFlags, setDietaryFlags] = useState<DietaryFlag[]>([]);
  const [members, setMembers] = useState<JigsawMember[]>([]);
  const [selfMemberId, setSelfMemberId] = useState<string | null>(null);
  const [decidingProposalId, setDecidingProposalId] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>("loading");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [failedTripId, setFailedTripId] = useState<string | null>(null);
  const [reconcileTripId, setReconcileTripId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Close the gap before React commits a disabled control.
  const locked = useRef(true);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    locked.current = true;
    setOperation("loading");
    setError(null);
    async function initialize() {
      let selected: string | undefined;
      try {
        const { trips: recent } = await request<{ trips: TripRecord[] }>("/api/trips", current.signal);
        if (current.signal.aborted) return;
        setTrips(recent);
        setReady(true);
        selected = new URLSearchParams(window.location.search).get("trip") || recent[0]?.id;
        const detail = selected ? await request<TripDetail>(`/api/trips/${encodeURIComponent(selected)}`, current.signal) : null;
        if (current.signal.aborted) return;
        setTrip(detail?.trip ?? null);
        setInput(detail ? inputFromTrip(detail.trip) : { ...emptyInput });
        setProposals(detail?.proposals ?? []);
        setDietaryFlags(detail?.dietaryFlags ?? []);
        setMembers(detail?.members ?? []);
        setSelfMemberId(detail?.selfMemberId ?? null);
        setFailedTripId(null);
        setReconcileTripId(null);
        setTripUrl(detail?.trip.id ?? null);
      } catch (cause) {
        if (!current.signal.aborted) {
          if (selected) {
            setFailedTripId(selected);
            setError(cause instanceof HttpError && [404, 422].includes(cause.status)
              ? "Selected trip is unavailable. Choose a recent trip or create a new trip."
              : "Unable to load the selected trip. Choose another trip or retry.");
          } else setError(cause instanceof Error ? cause.message : "Unable to load trips.");
        }
      } finally {
        if (!current.signal.aborted) { locked.current = false; setOperation(null); }
      }
    }
    void initialize();
    return () => { current.abort(); controller.current?.abort(); locked.current = true; };
  }, [reload]);

  function begin(next: Operation) {
    if (locked.current) return null;
    locked.current = true;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setOperation(next);
    setError(null);
    setNotice(null);
    setFailedTripId(null);
    return current;
  }

  function finish(current: AbortController) {
    if (!current.signal.aborted) { locked.current = false; setOperation(null); }
  }

  function updateSavedTrip(saved: TripRecord) {
    setTrip(saved);
    setInput(inputFromTrip(saved));
    setTrips((recent) => [saved, ...recent.filter((item) => item.id !== saved.id)]);
    setTripUrl(saved.id);
  }

  async function refreshDetail(id: string, current: AbortController) {
    const detail = await request<TripDetail>(`/api/trips/${encodeURIComponent(id)}`, current.signal);
    if (current.signal.aborted) return;
    updateSavedTrip(detail.trip);
    setProposals(detail.proposals);
    setDietaryFlags(detail.dietaryFlags);
    setMembers(detail.members ?? []);
    setSelfMemberId(detail.selfMemberId ?? null);
    setReconcileTripId(null);
  }

  async function selectTrip(id: string, force = false) {
    if (!ready || (!force && id === trip?.id)) return;
    const current = begin("loading");
    if (!current) return;
    try {
      await refreshDetail(id, current);
    } catch (cause) {
      if (!current.signal.aborted) {
        if (id === reconcileTripId) {
          setError("Unable to reload trip. Reload trip before making another decision.");
        } else {
          setError(cause instanceof Error ? cause.message : "Unable to load trip.");
          setFailedTripId(id);
        }
      }
    } finally { finish(current); }
  }

  function newTrip() {
    if (locked.current || !ready) return;
    setTrip(null); setInput({ ...emptyInput }); setProposals([]); setDietaryFlags([]); setTripUrl(null);
    setMembers([]); setSelfMemberId(null);
    setView("setup"); setError(null); setNotice(null); setFailedTripId(null);
    setReconcileTripId(null);
  }

  const requiresReconciliation = trip !== null && reconcileTripId === trip.id;
  const canEdit = (!trip ? !failedTripId : trip.role === "owner" || trip.role === "planner") && !requiresReconciliation;
  const busy = operation !== null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !ready || locked.current) return;
    const generate = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "generate";
    const dateError = validateTripDates(input.startDate, input.endDate);
    if (!input.destinationName.trim() || dateError) { setError(dateError || "Enter a destination."); return; }
    const current = begin("saving");
    if (!current) return;
    try {
      const { trip: saved } = await request<{ trip: TripRecord }>(
        trip ? `/api/trips/${encodeURIComponent(trip.id)}` : "/api/trips", current.signal,
        trip ? "PATCH" : "POST", { ...input, destinationName: input.destinationName.trim() },
      );
      if (current.signal.aborted) return;
      updateSavedTrip(saved);
      if (generate) {
        setOperation("generating");
        const { proposal } = await request<{ proposal: ProposalRecord }>(
          `/api/trips/${encodeURIComponent(saved.id)}/proposals`, current.signal, "POST",
        );
        if (current.signal.aborted) return;
        setProposals((existing) => [proposal, ...existing.filter((item) => item.id !== proposal.id)]);
        setView("plan");
      } else setNotice("Trip saved.");
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to save or generate the trip.");
    } finally { finish(current); }
  }

  async function decide(proposal: ProposalRecord, decision: "accept" | "reject") {
    if (!trip || trip.role !== "owner" || proposal.status !== "pending" || requiresReconciliation) return;
    if (decision === "accept" && (proposal.tripRevision !== trip.revision
      || !Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= Date.now())) return;
    const current = begin("deciding");
    if (!current) return;
    setDecidingProposalId(proposal.id);
    try {
      const { proposal: decided } = await request<{ proposal: ProposalRecord }>(
        `/api/trips/${encodeURIComponent(trip.id)}/proposals/${encodeURIComponent(proposal.id)}/decision`,
        current.signal, "POST", { decision },
      );
      if (current.signal.aborted) return;
      setProposals((existing) => existing.map((item) => item.id === decided.id ? decided
        : decided.status === "accepted" && item.status === "pending" ? { ...item, status: "expired" } : item));
      if (decided.status === "accepted") {
        const updated = { ...trip, activeProposalId: decided.id };
        setTrip(updated);
        setTrips((recent) => recent.map((item) => item.id === updated.id ? updated : item));
      }
    } catch (cause) {
      if (current.signal.aborted) return;
      if (cause instanceof HttpError && cause.status === 409) {
        setReconcileTripId(trip.id);
        setError("This trip changed in another session. Reloading trip...");
        setOperation("loading");
        try {
          await refreshDetail(trip.id, current);
          if (!current.signal.aborted) setError("This trip changed in another session. The latest trip is now loaded.");
        } catch {
          if (!current.signal.aborted) setError("Unable to refresh the changed trip. Reload trip before making another decision.");
        }
      } else if (!(cause instanceof HttpError) || cause.status >= 500 || cause.status === 408) {
        // A missing response does not prove that the server rolled back the decision.
        setReconcileTripId(trip.id);
        setError("The decision may have been saved. Reload trip before making another decision.");
      } else setError(cause.message);
    } finally { finish(current); setDecidingProposalId(null); }
  }

  const proposalsById = Object.fromEntries(proposals.map((proposal) => [proposal.id, proposal]));
  const active = proposals.find((item) => item.id === trip?.activeProposalId);
  const reviews = proposals.filter((item) => item.id !== trip?.activeProposalId);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-block"><Compass aria-hidden="true" /><strong>Waypoint</strong></div>
      <div className="account-actions"><span className="account-email">{email}</span>
        <form action="/auth/signout" method="post"><button type="submit" className="icon-button" aria-label="Sign out" title="Sign out" disabled={busy}><LogOut aria-hidden="true" /></button></form>
      </div>
    </header>
    <div className="trip-toolbar">
      <label className="trip-selector">Recent trips<select value={trip?.id ?? ""} disabled={busy || !ready || trips.length === 0} onChange={(event) => void selectTrip(event.target.value)}>
        <option value="" disabled>{!trip && failedTripId ? "Unavailable trip" : "New trip"}</option>
        {trips.map((item) => <option key={item.id} value={item.id}>{item.destinationName} / {item.startDate}</option>)}
      </select></label>
      <button className="secondary-button" type="button" disabled={busy || !ready} onClick={newTrip}><Plus aria-hidden="true" />New trip</button>
      {trip && <Link className="secondary-button" href={`/trips/${trip.id}/workspace`}><Users aria-hidden="true" />Timeline jigsaw</Link>}
    </div>
    <div className="app-body">
      <nav className="side-nav" role="tablist" aria-label="Trip workspace" aria-orientation="vertical">
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} id={`${id}-tab`} type="button" role="tab"
          aria-selected={view === id} aria-controls={`${id}-panel`} tabIndex={view === id ? 0 : -1}
          onClick={() => setView(id)} onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const index = TABS.findIndex((tab) => tab.id === id);
              const next = event.key === "Home" ? TABS[0] : event.key === "End" ? TABS[TABS.length - 1]
                : event.key === "ArrowDown" ? TABS[(index + 1) % TABS.length] : TABS[(index - 1 + TABS.length) % TABS.length];
              setView(next.id); document.getElementById(`${next.id}-tab`)?.focus();
            }
          }}>
          <Icon aria-hidden="true" />{label}
        </button>)}
      </nav>
      <div className="workspace-main">
        {operation && <div className="inline-notice" role="status"><LoaderCircle className="spin" aria-hidden="true" />
          {operation === "loading" ? "Loading trips..." : operation === "saving" ? "Saving trip..." : operation === "generating" ? "Generating proposal..." : "Updating proposal..."}</div>}
        {error && <div className="error-notice" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span>
          {requiresReconciliation && <button className="secondary-button" type="button" disabled={busy} onClick={() => void selectTrip(trip.id, true)}><RotateCcw aria-hidden="true" />Reload trip</button>}
          {(!ready || failedTripId) && <button type="button" className="secondary-button" disabled={busy} onClick={() => failedTripId ? void selectTrip(failedTripId) : setReload((value) => value + 1)}><RotateCcw aria-hidden="true" />Retry</button>}
        </div>}
        {notice && <p className="inline-notice" role="status">{notice}</p>}
        <section id="setup-panel" role="tabpanel" aria-labelledby="setup-tab" hidden={view !== "setup"}>
          <div className="section-heading"><h1>{trip ? "Trip details" : failedTripId ? "Trip unavailable" : "New trip"}</h1>{trip && <span className="role-label">{trip.role}</span>}</div>
          <form id="trip-input-form" onSubmit={save}>
            <fieldset className="trip-fields" disabled={busy || !ready || !canEdit}>
              <legend className="sr-only">Trip details</legend>
              <label className="wide">Destination<input name="destinationName" required maxLength={120} value={input.destinationName} onChange={(event) => setInput({ ...input, destinationName: event.target.value })} autoComplete="off" /></label>
              <label>Start date<input name="startDate" type="date" required value={input.startDate} onChange={(event) => setInput({ ...input, startDate: event.target.value })} /></label>
              <label>End date<input name="endDate" type="date" required min={input.startDate || undefined} value={input.endDate} onChange={(event) => setInput({ ...input, endDate: event.target.value })} /></label>
              <label className="wide">Budget<select name="budgetTier" value={input.budgetTier} onChange={(event) => setInput({ ...input, budgetTier: event.target.value as TripInput["budgetTier"] })}>
                {budgetTiers.map((tier) => <option key={tier.value} value={tier.value}>{tier.label}</option>)}
              </select></label>
              <fieldset className="pace-field wide"><legend>Pace</legend><div className="segmented">
                {paceLevels.map((pace) => <label key={pace.value}><input type="radio" name="pace" value={pace.value} checked={input.pace === pace.value} onChange={() => setInput({ ...input, pace: pace.value })} /><span>{pace.label}</span></label>)}
              </div></fieldset>
              <label className="wide">Group notes<textarea name="notes" rows={4} maxLength={1000} value={input.notes ?? ""} onChange={(event) => setInput({ ...input, notes: event.target.value })} /></label>
              <div className="form-actions wide"><button className="secondary-button" type="submit" value="save"><Save aria-hidden="true" />Save trip</button>
                <button className="primary-button" type="submit" value="generate"><Sparkles aria-hidden="true" />Generate plan</button></div>
            </fieldset>
          </form>
          {trip && <DietaryConstraintPicker tripId={trip.id} flags={dietaryFlags} disabled={busy} />}
        </section>
        <section id="plan-panel" role="tabpanel" aria-labelledby="plan-tab" hidden={view !== "plan"}>
          <div className="section-heading"><h1>Plan</h1></div>
          {active ? <GeminiProposalReview proposal={active} active />
            : trip?.activeProposalId && <div className="empty-state"><Compass aria-hidden="true" /><h2>Active itinerary unavailable</h2>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}><RotateCcw aria-hidden="true" />Retry</button></div>}
          {reviews.length === 0 ? <div className="empty-state"><FileText aria-hidden="true" /><h2>{active ? "No pending proposals" : "No proposals yet"}</h2>
            <button type="button" className="secondary-button" onClick={() => setView("setup")}><Settings2 aria-hidden="true" />Trip details</button></div>
            : reviews.map((proposal) => <GeminiProposalReview key={proposal.id} proposal={proposal}
              canDecide={trip?.role === "owner"} outdated={proposal.tripRevision !== trip?.revision} busy={busy || requiresReconciliation}
              onDecision={(decision) => void decide(proposal, decision)} />)}
        </section>
        <section id="timeline-panel" role="tabpanel" aria-labelledby="timeline-tab" hidden={view !== "timeline"} className="embedded-pane" aria-label="Itinerary timeline">
          {view === "timeline" && (trip ? <TimelinePane tripId={trip.id} startDate={trip.startDate} endDate={trip.endDate} revision={trip.revision} />
            : <div className="empty-state"><MapIcon aria-hidden="true" /><h2>Select a trip to see its timeline</h2></div>)}
        </section>
        <section id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" hidden={view !== "chat"} className="embedded-pane" aria-label="Group chat">
          {view === "chat" && (trip ? <ChatPane tripId={trip.id} selfMemberId={selfMemberId} members={members} proposalsById={proposalsById}
            canDecideProposals={trip.role === "owner"} activeProposalId={trip.activeProposalId} decidingProposalId={decidingProposalId}
            onDecision={(proposalId, decision) => { const target = proposals.find((item) => item.id === proposalId); if (target) void decide(target, decision); }} />
            : <div className="empty-state"><MessageSquare aria-hidden="true" /><h2>Select a trip to see its chat</h2></div>)}
        </section>
      </div>
    </div>
  </main>;
}
