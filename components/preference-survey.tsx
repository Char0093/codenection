"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { budgetTiers, paceLevels } from "@/lib/domain/trip";
import { DEMO_INTERESTS, DEMO_PREFERENCES } from "@/lib/prototype/fixtures";

const SOCIAL_ROLES = [
  { value: "planner", label: "Planner", hint: "I like building the itinerary" },
  { value: "navigator", label: "Navigator", hint: "I keep us moving on the day" },
  { value: "follower", label: "Follower", hint: "Happy to go with the group" },
] as const;

const label = (key: string) => DEMO_INTERESTS.find((i) => i.key === key)?.label ?? key;

/**
 * Feature: preference survey & editor ("My Travel Preferences"). The compact interest / budget /
 * pace / role / walking baseline that the safety-first onboarding deliberately leaves out. Ranked
 * interests become this member's weight vector in the jigsaw fairness engine. Editing here is a
 * SOFT change: it steers future suggestions and never rewrites an active itinerary -- only a
 * safety requirement (edited from the Travel DNA screen) triggers an itinerary review.
 * Prototype: all state is local and resets on refresh.
 */
export function PreferenceSurvey() {
  const [order, setOrder] = useState<string[]>(DEMO_PREFERENCES.interestOrder);
  const [budget, setBudget] = useState<string>(DEMO_PREFERENCES.budgetTier);
  const [pace, setPace] = useState<string>(DEMO_PREFERENCES.pace);
  const [role, setRole] = useState<string>(DEMO_PREFERENCES.socialRole);
  const [walkCap, setWalkCap] = useState<number>(DEMO_PREFERENCES.dailyWalkCapKm);
  const [saved, setSaved] = useState(false);

  function move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= order.length) return;
    const copy = [...order];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    setOrder(copy);
    setSaved(false);
  }

  return (
    <form className="pref-survey" onSubmit={(e) => { e.preventDefault(); setSaved(true); }}>
      <div className="section-heading">
        <div>
          <h1>Your travel preferences</h1>
          <p className="field-hint">
            What you enjoy, how you like to travel. This shapes suggestions and your share of the
            group plan. It is separate from your safety needs, which live in Travel DNA.
          </p>
        </div>
      </div>

      <fieldset className="pref-rank">
        <legend>Rank your interests — most wanted first</legend>
        <ol>
          {order.map((key, index) => (
            <li key={key}>
              <span className="pref-rank-num">{index + 1}</span>
              <span className="pref-rank-label">{label(key)}</span>
              <span className="pref-rank-controls">
                <button type="button" aria-label={`Move ${label(key)} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label={`Move ${label(key)} down`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </fieldset>

      <label>
        Usual budget
        <select value={budget} onChange={(e) => { setBudget(e.target.value); setSaved(false); }}>
          {budgetTiers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>

      <label>
        Preferred pace
        <select value={pace} onChange={(e) => { setPace(e.target.value); setSaved(false); }}>
          {paceLevels.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>

      <fieldset className="pref-role">
        <legend>On a trip I&rsquo;m usually the…</legend>
        {SOCIAL_ROLES.map((r) => (
          <label key={r.value}>
            <input type="radio" name="social-role" checked={role === r.value}
              onChange={() => { setRole(r.value); setSaved(false); }} />
            <span><strong>{r.label}</strong> — {r.hint}</span>
          </label>
        ))}
      </fieldset>

      <label className="pref-walk">
        Comfortable walking per day: <strong>{walkCap} km</strong>
        <input type="range" min={2} max={15} step={1} value={walkCap}
          onChange={(e) => { setWalkCap(Number(e.target.value)); setSaved(false); }} />
      </label>

      <p className="pref-note field-hint">
        Saving applies a <strong>soft change</strong>: new suggestions use it right away, but your
        current itinerary is not rewritten. Tightening a safety requirement (Travel DNA) is the
        only change that forces an itinerary review.
      </p>

      {saved && (
        <p className="inline-notice" role="status">
          <Check size={14} aria-hidden="true" />
          <span>Saved for this session — demo only, resets on refresh.</span>
        </p>
      )}
      <div className="onboarding-nav">
        <span />
        <button type="submit" className="primary-button">Save preferences</button>
      </div>
    </form>
  );
}
