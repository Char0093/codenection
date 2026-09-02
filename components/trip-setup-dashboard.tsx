"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { demoCandidates, demoMembers, demoTrip } from "@/features/planning/demo-data";
import {
  generateItineraryProposal,
  type ItineraryProposal,
  type MemberPlanningProfile,
} from "@/lib/domain/itinerary";
import { confirmProposal } from "@/lib/domain/proposal";
import { budgetTiers, paceLevels, validateTripDates, type TripSetupInput } from "@/lib/domain/trip";
import { LocalPlanningRepository } from "@/lib/repositories/local-planning-repository";

type View = "overview" | "people" | "itinerary";
type ProposalState = "idle" | "pending" | "accepted";

const providerHealth = [
  { name: "Maps", status: "Ready", tone: "ok" },
  { name: "Weather", status: "Demo forecast", tone: "mocked" },
  { name: "Rates", status: "Ready", tone: "ok" },
  { name: "Telegram", status: "Not connected", tone: "muted" },
] as const;

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function displayConstraint(value: string): string {
  return value.replaceAll("_", " ");
}

export function TripSetupDashboard() {
  const repository = useRef(new LocalPlanningRepository());
  const [view, setView] = useState<View>("overview");
  const [trip, setTrip] = useState<TripSetupInput>(demoTrip);
  const [members, setMembers] = useState<MemberPlanningProfile[]>(demoMembers);
  const [proposalState, setProposalState] = useState<ProposalState>("idle");
  const [proposal, setProposal] = useState<ItineraryProposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = repository.current.load({ trip: demoTrip, members: demoMembers, proposalStatus: "idle" });
    setTrip(saved.trip);
    setMembers(saved.members);
    setProposalState(saved.proposalStatus);
    if (saved.proposalStatus !== "idle") {
      setProposal(generateItineraryProposal(demoCandidates, {
        budgetTier: saved.trip.budgetTier,
        pace: saved.trip.pace,
        weather: "rain",
        members: saved.members,
      }));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    repository.current.save({ trip, members, proposalStatus: proposalState });
  }, [hydrated, members, proposalState, trip]);

  const pendingMembers = members.filter((member) => member.consentStatus !== "granted");
  const readiness = useMemo(() => {
    const consentPoints = Math.round((members.filter((member) => member.consentStatus === "granted").length / members.length) * 30);
    return Math.min(100, 35 + consentPoints + (proposalState !== "idle" ? 20 : 0) + (proposalState === "accepted" ? 15 : 0));
  }, [members, proposalState]);

  function resetProposal(): void {
    setProposal(null);
    setProposalState("idle");
    setNotice(null);
  }

  function updateConsent(memberId: string): void {
    setMembers((current) => current.map((member) => member.id === memberId
      ? { ...member, consentStatus: member.consentStatus === "granted" ? "revoked" : "granted" }
      : member));
    resetProposal();
  }

  function saveTrip(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const startDate = String(values.get("startDate"));
    const endDate = String(values.get("endDate"));
    const dateError = validateTripDates(startDate, endDate);
    if (dateError) {
      setNotice(dateError);
      return;
    }

    setTrip((current) => ({
      ...current,
      name: String(values.get("name")),
      destinationName: String(values.get("destinationName")),
      startDate,
      endDate,
      baseCurrency: String(values.get("baseCurrency")).toUpperCase(),
      notes: String(values.get("notes")),
    }));
    resetProposal();
    setNotice("Trip details saved in demo storage.");
  }

  function generateProposal(): void {
    if (pendingMembers.length > 0) return;
    const nextProposal = generateItineraryProposal(demoCandidates, {
      budgetTier: trip.budgetTier,
      pace: trip.pace,
      weather: "rain",
      members,
    });
    setProposal(nextProposal);
    setProposalState("pending");
    setNotice(null);
    setView("itinerary");
  }

  function activateProposal(): void {
    if (!proposal || proposalState !== "pending") return;
    const status = confirmProposal(proposalState, "owner");
    setProposalState(status === "accepted" ? "accepted" : "pending");
    setNotice("Itinerary activated after owner confirmation.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">W</div>
          <div><strong>Waypoint</strong><span>Group travel operations</span></div>
        </div>
        <div className="trip-identity">
          <span className="live-dot" aria-hidden="true" />
          <div><strong>{trip.name}</strong><span>{trip.destinationName} · {trip.startDate} to {trip.endDate}</span></div>
        </div>
        <button className="avatar" type="button" title="Trip owner profile" aria-label="Trip owner profile">CO</button>
      </header>

      <nav className="view-tabs" aria-label="Trip workspace">
        {(["overview", "people", "itinerary"] as View[]).map((item) => (
          <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>
            {item === "overview" ? "Overview" : item === "people" ? `People · ${members.length}` : "Itinerary"}
            {item === "people" && pendingMembers.length > 0 && <span className="tab-alert">{pendingMembers.length}</span>}
          </button>
        ))}
      </nav>

      <div className="workspace">
        <section className="workspace-main">
          {view === "overview" && (
            <>
              <div className="section-heading">
                <div><span className="kicker">Active trip</span><h1>Trip readiness</h1></div>
                <div className="readiness-score"><strong>{readiness}%</strong><span>ready</span></div>
              </div>
              <div className="progress-track" aria-label={`${readiness}% ready`}><span style={{ width: `${readiness}%` }} /></div>
              <div className="metric-row">
                <div><span>Travelers</span><strong>{members.length}</strong><small>{pendingMembers.length} consent pending</small></div>
                <div><span>Plan status</span><strong>{proposalState === "accepted" ? "Active" : proposalState === "pending" ? "Review" : "Not generated"}</strong><small>Rain-aware scoring</small></div>
                <div><span>Safety conflicts</span><strong>{proposal?.conflicts.length ?? "-"}</strong><small>Hard blockers retained</small></div>
              </div>

              <section className="form-section">
                <div className="section-title"><div><h2>Trip settings</h2><p>Operational inputs used by every recommendation.</p></div><span className="mode-badge">Local demo</span></div>
                <form
                  className="trip-form"
                  key={[trip.name, trip.destinationName, trip.startDate, trip.endDate, trip.baseCurrency, trip.notes].join("|")}
                  onSubmit={saveTrip}
                >
                  <label className="wide">Trip name<input name="name" required defaultValue={trip.name} /></label>
                  <label>Destination<input name="destinationName" required defaultValue={trip.destinationName} /></label>
                  <label>Currency<input name="baseCurrency" maxLength={3} required defaultValue={trip.baseCurrency} /></label>
                  <label>Start date<input name="startDate" type="date" required defaultValue={trip.startDate} /></label>
                  <label>End date<input name="endDate" type="date" required defaultValue={trip.endDate} /></label>
                  <fieldset className="wide"><legend>Budget</legend><div className="segmented">{budgetTiers.map((tier) => <button key={tier.value} type="button" className={trip.budgetTier === tier.value ? "active" : ""} onClick={() => { setTrip({ ...trip, budgetTier: tier.value }); resetProposal(); }}>{tier.label}</button>)}</div></fieldset>
                  <fieldset className="wide"><legend>Pace</legend><div className="segmented">{paceLevels.map((level) => <button key={level.value} type="button" className={trip.pace === level.value ? "active" : ""} onClick={() => { setTrip({ ...trip, pace: level.value }); resetProposal(); }}>{level.label}</button>)}</div></fieldset>
                  <label className="wide">Group notes<textarea name="notes" rows={3} defaultValue={trip.notes} /></label>
                  <div className="form-actions wide"><button className="secondary-button" type="submit">Save settings</button><button className="primary-button" type="button" disabled={pendingMembers.length > 0} onClick={generateProposal}>Generate proposal</button></div>
                </form>
                {notice && <div className="inline-notice" role="status">{notice}</div>}
              </section>
            </>
          )}

          {view === "people" && (
            <>
              <div className="section-heading"><div><span className="kicker">Consent and constraints</span><h1>Travelers</h1></div><span className="count-badge">{members.length} members</span></div>
              <div className="member-list">
                {members.map((member) => (
                  <article className="member-card" key={member.id}>
                    <div className={`member-avatar avatar-${member.id}`}>{initials(member.displayName)}</div>
                    <div className="member-content">
                      <div className="member-title"><div><h2>{member.displayName}</h2><span>{member.id === "aisha" ? "Trip owner" : "Traveler"}</span></div><span className={`consent-status ${member.consentStatus}`}>{member.consentStatus}</span></div>
                      {member.consentStatus === "granted" ? (
                        <div className="constraint-groups">
                          <div><span>Safety constraints</span><div className="tag-row">{[...member.severeAllergies, ...member.accessibilityRequirements].length > 0 ? [...member.severeAllergies, ...member.accessibilityRequirements].map((item) => <span className="constraint-tag safety" key={item}>{displayConstraint(item)}</span>) : <span className="constraint-tag neutral">None declared</span>}</div></div>
                          <div><span>Dietary fit</span><div className="tag-row">{member.dietaryRequirements.length > 0 ? member.dietaryRequirements.map((item) => <span className="constraint-tag" key={item}>{displayConstraint(item)}</span>) : <span className="constraint-tag neutral">No preference</span>}</div></div>
                        </div>
                      ) : <p className="private-copy">Profile details are excluded from planning until consent is granted.</p>}
                    </div>
                    <button className={`switch ${member.consentStatus === "granted" ? "on" : ""}`} role="switch" aria-checked={member.consentStatus === "granted"} aria-label={`Planning consent for ${member.displayName}`} onClick={() => updateConsent(member.id)} type="button"><span /></button>
                  </article>
                ))}
              </div>
            </>
          )}

          {view === "itinerary" && (
            <>
              <div className="section-heading">
                <div><span className="kicker">Saturday · 3 October</span><h1>Itinerary proposal</h1></div>
                <span className={`proposal-status ${proposalState}`}>{proposalState === "idle" ? "Not generated" : proposalState}</span>
              </div>
              {!proposal ? (
                <div className="empty-state">
                  <div className="empty-mark" aria-hidden="true">01</div>
                  <h2>No proposal yet</h2>
                  <p>{pendingMembers.length > 0 ? "Resolve member consent before profile-based planning can run." : "The trip is ready for deterministic candidate scoring."}</p>
                  <button className="primary-button" type="button" disabled={pendingMembers.length > 0} onClick={generateProposal}>Generate proposal</button>
                </div>
              ) : (
                <>
                  <div className="proposal-banner">
                    <div><strong>{proposal.items.length} viable stops</strong><span>{proposal.conflicts.length} rejected by hard constraints · Demo rain forecast</span></div>
                    {proposalState === "pending" && <button className="primary-button" type="button" onClick={activateProposal}>Approve and activate</button>}
                    {proposalState === "accepted" && <span className="active-label">Owner confirmed</span>}
                  </div>
                  <div className="timeline">
                    {proposal.items.map((item, index) => (
                      <article className="timeline-item" key={item.candidate.id}>
                        <div className="time-block"><strong>{item.candidate.startTime}</strong><span>{item.candidate.durationMinutes} min</span></div>
                        <div className="timeline-line"><span>{index + 1}</span></div>
                        <div className="activity-block">
                          <div className="activity-title"><div><span className="category">{item.candidate.category}</span><h2>{item.candidate.title}</h2></div><strong className="score">{item.score}</strong></div>
                          <div className="activity-meta"><span>{item.candidate.travelMinutes} min transfer</span><span>{item.candidate.costTier} cost</span><span>{item.candidate.indoor ? "indoors" : "outdoors"}</span></div>
                          <div className="reason-row">{item.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {proposal.conflicts.length > 0 && <section className="conflict-section"><div className="section-title"><div><h2>Rejected candidates</h2><p>Hard blockers remain visible for review.</p></div><span className="conflict-count">{proposal.conflicts.length}</span></div>{proposal.conflicts.map((conflict) => <div className="conflict-row" key={conflict.candidate.id}><div><strong>{conflict.candidate.title}</strong><span>{conflict.candidate.category}</span></div><p>{conflict.blockers.join(" ")}</p></div>)}</section>}
                  {notice && <div className="inline-notice" role="status">{notice}</div>}
                </>
              )}
            </>
          )}
        </section>

        <aside className="workspace-side">
          <section className="side-section">
            <div className="section-title"><div><h2>Planning gates</h2><p>Current decision readiness</p></div></div>
            <ul className="gate-list">
              <li className="complete"><span>1</span><div><strong>Trip settings</strong><small>Destination, dates, budget</small></div></li>
              <li className={pendingMembers.length === 0 ? "complete" : "attention"}><span>2</span><div><strong>Member consent</strong><small>{pendingMembers.length === 0 ? "All profiles available" : `${pendingMembers.length} response pending`}</small></div></li>
              <li className={proposalState !== "idle" ? "complete" : "pending"}><span>3</span><div><strong>Agent proposal</strong><small>{proposalState === "idle" ? "Waiting to generate" : "Scored and explained"}</small></div></li>
              <li className={proposalState === "accepted" ? "complete" : "pending"}><span>4</span><div><strong>Owner confirmation</strong><small>{proposalState === "accepted" ? "Itinerary active" : "Explicit approval required"}</small></div></li>
            </ul>
          </section>

          <section className="side-section provider-section">
            <div className="section-title"><div><h2>Provider health</h2><p>02 Sep · 15:40 MYT</p></div></div>
            <ul className="provider-list">{providerHealth.map((provider) => <li key={provider.name}><span>{provider.name}</span><strong className={provider.tone}><i />{provider.status}</strong></li>)}</ul>
          </section>

          <section className="safety-note"><strong>Safety boundary</strong><p>Allergy and accessibility blockers override itinerary scores. No proposal changes trip state until an owner confirms it.</p></section>
        </aside>
      </div>
    </main>
  );
}
