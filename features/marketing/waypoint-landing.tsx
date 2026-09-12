"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock, ListChecks, Map as MapIcon, MessageCircle, ShieldCheck, Split, Wallet,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

/**
 * Waypoint's public marketing landing page -- the first thing a signed-out visitor sees at "/".
 * Structural reference only (hero + live-demo split, feature grid, closing CTA) came from
 * reviewing another product's layout; every word of copy and every feature claim here describes
 * Waypoint's own group-trip chat, AI assistant, and jigsaw fairness engine.
 */

const NAV_DEMO_ITEMS = [
  { key: "chat", label: "Chat", icon: MessageCircle },
  { key: "plan", label: "Plan", icon: ListChecks },
  { key: "timeline", label: "Timeline", icon: CalendarClock },
  { key: "map", label: "Map", icon: MapIcon },
  { key: "jigsaw", label: "Split & merge", icon: Split },
  { key: "budget", label: "Budget", icon: Wallet },
  { key: "safety", label: "Food check", icon: ShieldCheck },
] as const;

const DEMO_SCRIPT = [
  {
    q: "Draft a 3-day itinerary for George Town",
    a: "Drafted — Day 1 heritage walk & hawker lunch, Day 2 island hop, Day 3 café crawl. Saturday afternoon kept indoors for rain.",
    tag: "Trip assistant · @ai",
  },
  {
    q: "Who can't eat shellfish?",
    a: "Arun has a confirmed shellfish allergy. Every food stop on the itinerary is re-checked against it automatically.",
    tag: "Safety gate · Constraints",
    confirmed: true,
  },
  {
    q: "Split the group for the afternoon?",
    a: "One member's satisfaction drops to 47% if everyone stays together. Suggested: split into two tracks, rejoin for dinner.",
    tag: "Jigsaw · Fairness engine",
  },
] as const;

function DemoChatPanel() {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"user" | "typing" | "answer">("user");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }
    function run() {
      clearTimers();
      setPhase("user");
      timers.current.push(setTimeout(() => setPhase("typing"), reduced ? 30 : 500));
      timers.current.push(setTimeout(() => setPhase("answer"), reduced ? 60 : 1500));
      timers.current.push(setTimeout(() => setIdx((i) => (i + 1) % DEMO_SCRIPT.length), reduced ? 200 : 6500));
    }
    run();
    return clearTimers;
  }, [idx]);

  const s = DEMO_SCRIPT[idx];

  return (
    <div className="mkt-demo-wrap">
      <div className="mkt-demo-frame">
        <div className="mkt-demo-chrome"><i /><i /><i /></div>
        <div className="mkt-demo-body">
          <div className="mkt-demo-side">
            <span className="mkt-brand"><span className="mkt-brand-mark"><BrandMark size={12} /></span>Waypoint</span>
            {NAV_DEMO_ITEMS.map((item) => (
              <div key={item.key} className={"mkt-demo-nav-item" + (item.key === "chat" ? " active" : "")}>
                <item.icon aria-hidden="true" /><span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="mkt-demo-chat">
            <div className="mkt-demo-msg user show">
              <div className="mkt-demo-bubble">{s.q}</div>
            </div>
            {phase === "typing" && (
              <div className="mkt-demo-msg ai show">
                <div className="mkt-demo-typing"><span /><span /><span /></div>
              </div>
            )}
            {phase === "answer" && (
              <div className="mkt-demo-msg ai show">
                <div className="mkt-demo-bubble">{s.a}</div>
                <div className="mkt-demo-tags">
                  <span className="mkt-tag mkt-tag-source">{s.tag}</span>
                  {"confirmed" in s && s.confirmed && <span className="mkt-tag mkt-tag-confirmed">CONFIRMED</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mkt-verified-pill"><i />Realtime · every member sees this</div>
    </div>
  );
}

export function WaypointLanding() {
  return (
    <div className="mkt mkt-landing">
      <nav className="mkt-nav">
        <span className="mkt-brand"><span className="mkt-brand-mark"><BrandMark size={16} /></span>Waypoint</span>
        <div className="mkt-nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
        </div>
        <div className="mkt-nav-actions">
          <Link href="/entering" className="mkt-link-btn">Log in</Link>
          <Link href="/entering" className="mkt-btn mkt-btn-primary mkt-btn-sm">Get started</Link>
        </div>
      </nav>

      <div className="mkt-hero">
        <div className="mkt-mesh"><i /><i /><i /></div>
        <div>
          <span className="mkt-eyebrow"><i />Group trip planning, one shared chat</span>
          <h1 className="mkt-h1"><span>Plan the trip.</span><span>Not the arguments.</span></h1>
          <p className="mkt-sub">
            One chat everyone&apos;s already in, an AI that drafts the itinerary from what you say, and a
            fairness engine that settles who splits from the group and who owes what — planning
            together finally feels together.
          </p>
          <div className="mkt-ctas">
            <Link href="/entering" className="mkt-btn mkt-btn-primary">Start planning free</Link>
            <a href="#features" className="mkt-btn mkt-btn-ghost">See it in action</a>
          </div>
        </div>
        <DemoChatPanel />
      </div>

      <div id="features" className="mkt-section">
        <div className="mkt-section-head">
          <span className="mkt-eyebrow" style={{ animation: "none", opacity: 1 }}><i />Built for the whole group, not one organizer</span>
          <h2>Everything a trip chat should already do</h2>
          <p>Waypoint keeps the conversation and the plan in the same place, so nothing gets lost between apps.</p>
        </div>
        <div className="mkt-feat-grid">
          <FeatCard grad="linear-gradient(135deg,var(--mkt-teal),var(--mkt-teal-deep))" icon={<MessageCircle aria-hidden="true" />}
            title="An AI assistant that's actually in the chat" body="Mention @ai and it drafts or updates the itinerary from the conversation itself — no separate planning tool to keep in sync." />
          <FeatCard grad="linear-gradient(135deg,var(--mkt-violet),var(--mkt-violet-ink))" icon={<ShieldCheck aria-hidden="true" />}
            title="Safety constraints that can't be missed" body="Allergies and access needs confirmed once are checked against every stop automatically — never buried in a chat thread." />
          <FeatCard grad="linear-gradient(135deg,var(--mkt-coral),var(--mkt-coral-deep))" icon={<Split aria-hidden="true" />}
            title="A fairness engine, not a majority vote" body="When the group's preferences genuinely diverge, Waypoint proposes a split that reconverges for dinner — instead of one person just going along with it." />
        </div>
      </div>

      <div id="how-it-works" className="mkt-section">
        <div className="mkt-section-head">
          <span className="mkt-eyebrow" style={{ animation: "none", opacity: 1 }}><i />From group chat to ready itinerary</span>
          <h2>How a trip comes together</h2>
        </div>
        <div className="mkt-feat-grid">
          <FeatCard grad="linear-gradient(135deg,#0EA5A6,#0A7E7F)" icon={<span style={{ fontWeight: 800 }}>1</span>}
            title="Start a trip chat" body="Set a destination and rough dates. Everyone you invite lands in the same conversation." />
          <FeatCard grad="linear-gradient(135deg,#6D5EF8,#4A3FC7)" icon={<span style={{ fontWeight: 800 }}>2</span>}
            title="Chat like you normally would" body="Mention a jazz bar, a dietary need, a rough budget — Waypoint picks up the signal and asks before it acts on it." />
          <FeatCard grad="linear-gradient(135deg,#FF6B57,#E5503C)" icon={<span style={{ fontWeight: 800 }}>3</span>}
            title="Get a plan everyone actually agrees to" body="A drag-to-compromise timeline and a fair split when needed — confirmed by the group, not assumed." />
        </div>
      </div>

      <div className="mkt-cta">
        <div className="mkt-cta-inner">
          <div className="mkt-mesh"><i /><i /><i /></div>
          <h2>Start your next group trip in one chat.</h2>
          <p>Free to start — invite your group in minutes.</p>
          <div className="mkt-ctas">
            <Link href="/entering" className="mkt-btn mkt-btn-primary">Start planning free</Link>
            <a href="#how-it-works" className="mkt-btn mkt-btn-ghost">See how it works</a>
          </div>
        </div>
      </div>

      <div className="mkt-footer">
        <span className="mkt-brand"><span className="mkt-brand-mark" style={{ width: 22, height: 22, borderRadius: 7 }}><BrandMark size={12} /></span>Waypoint</span>
        <span>© 2026 Waypoint. Group trips, planned together.</span>
      </div>
    </div>
  );
}

function FeatCard({ grad, icon, title, body }: { grad: string; icon: React.ReactNode; title: string; body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={"mkt-feat-card" + (inView ? " in" : "")}>
      <div className="mkt-feat-icon" style={{ background: grad }}>{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
