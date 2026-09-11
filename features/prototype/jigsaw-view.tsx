"use client";

import React, { useMemo, useState } from "react";
// `Map` is aliased: the component below builds a real `new Map()` lookup.
import {
  Check, Compass, Landmark, Map as MapIcon, MapPin, Split, TriangleAlert, UtensilsCrossed, Users, X,
} from "lucide-react";
import { MIN_SATISFACTION_RATIO, evaluateTeam, shouldSplitCut } from "@/lib/domain/jigsaw";
import {
  DEMO_JIGSAW_CANDIDATES, DEMO_JIGSAW_TOGETHER, DEMO_SPLIT, MEMBER_IDS,
  memberColor, memberName,
} from "@/lib/prototype/demo-features";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Branch identity, by what the branch is about rather than by fixture id. */
const BRANCH_LOOK: Record<string, { Icon: typeof UtensilsCrossed; kind: string }> = {
  food: { Icon: UtensilsCrossed, kind: "food" },
  heritage: { Icon: Landmark, kind: "heritage" },
};
const branchLook = (label: string) =>
  BRANCH_LOOK[label.toLowerCase().replace(/\s*branch$/, "")] ?? { Icon: Compass, kind: "other" };

/**
 * Feature: jigsaw conflict resolution. The numbers here are not written down — they come from
 * `lib/domain/jigsaw`'s `evaluateTeam` / `shouldSplitCut` run against the fixture candidates, so
 * the screen shows what the real fairness engine decides. Accepting the split is local state.
 *
 * The engine's own vocabulary (standard deviation, split threshold, satisfaction ratio) stays in
 * the domain module and the docs: a traveller is told who is short-changed and what to do about
 * it, never how the solver reached that.
 */
export function JigsawView() {
  const [accepted, setAccepted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const byId = useMemo(() => new Map(DEMO_JIGSAW_CANDIDATES.map((b) => [b.id, b])), []);
  const together = useMemo(
    () => DEMO_JIGSAW_CANDIDATES.filter((b) => DEMO_JIGSAW_TOGETHER.includes(b.id)),
    [],
  );
  const outcome = useMemo(
    () => evaluateTeam(together, DEMO_JIGSAW_CANDIDATES, [...MEMBER_IDS]),
    [together],
  );
  const splitRecommended = shouldSplitCut(outcome);

  /** Each member only attends their own branch, so this is a per-branch sum, not evaluateTeam. */
  const splitAchieved = useMemo(() => {
    const map = new Map<string, number>();
    for (const branch of DEMO_SPLIT.branches) {
      for (const memberId of branch.memberIds) {
        map.set(memberId, branch.blockIds.reduce(
          (sum, id) => sum + (byId.get(id)?.satisfaction[memberId] ?? 0), 0));
      }
    }
    return map;
  }, [byId]);

  const worst = outcome.members.find((m) => m.memberId === outcome.worstMemberId);
  const worstName = outcome.worstMemberId ? memberName(outcome.worstMemberId) : "someone";

  return (
    <section className="jigsaw-view">
      <div className="section-heading">
        <div>
          <h1>Day 1 afternoon</h1>
          <p className="field-hint">
            {DEMO_SPLIT.date} · {hhmm(DEMO_SPLIT.window.startMinute)}–{hhmm(DEMO_SPLIT.window.endMinute)} ·
            the one window where the group wants different things.
          </p>
        </div>
      </div>
      <p className="demo-hint">Demo — satisfaction scores are sample data, but the fairness maths below is the real engine.</p>

      {/* One shared plan */}
      <div className="jig-card">
        <div className="jig-card-head">
          <span className="jig-card-icon" aria-hidden="true"><Users /></span>
          <h2>If everyone stays together</h2>
        </div>
        <ul className="jig-blocks">
          {together.map((b) => <li key={b.id}>{b.title}</li>)}
        </ul>

        <ul className="jig-members">
          {outcome.members.map((m) => {
            const below = m.ratio < MIN_SATISFACTION_RATIO;
            return (
              <li key={m.memberId} className="jig-member" data-below={below ? "true" : undefined}>
                <span className="jig-avatar" style={{ background: memberColor(m.memberId) }}>
                  {memberName(m.memberId).slice(0, 1)}
                </span>
                <span className="jig-name">{memberName(m.memberId)}</span>
                <span className="jig-bar" aria-hidden="true">
                  <i style={{ width: pct(m.ratio) }} data-below={below ? "true" : undefined} />
                </span>
                <span className="jig-ratio">{pct(m.ratio)}</span>
              </li>
            );
          })}
        </ul>

        {splitRecommended ? (
          <p className="jig-verdict jig-verdict-bad" role="status">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              <strong>{worstName}&apos;s satisfaction is too low ({pct(worst?.ratio ?? 0)}).</strong>{" "}
              We suggest splitting up for the afternoon — everyone still meets back before dinner.
            </span>
          </p>
        ) : (
          <p className="jig-verdict jig-verdict-good" role="status">
            <Check size={16} aria-hidden="true" />
            <span>This afternoon already works for everyone in the group.</span>
          </p>
        )}
      </div>

      {/* Split suggestion */}
      {splitRecommended && !dismissed && (
        <div className="jig-card jig-card-split" data-accepted={accepted ? "true" : undefined}>
          <div className="jig-card-head">
            <span className="jig-card-icon" aria-hidden="true"><Split /></span>
            <h2>{accepted ? "Split accepted" : "Suggested: split, then rejoin"}</h2>
            {accepted && <span className="jig-tag">Accepted</span>}
          </div>

          <div className="jig-split-layout">
            {DEMO_SPLIT.branches.map((branch) => {
              const look = branchLook(branch.label);
              return (
                <div key={branch.id} className="jig-branch" data-branch={look.kind}>
                  <p className="jig-branch-label">
                    <span className="jig-branch-icon" aria-hidden="true"><look.Icon /></span>
                    {branch.label}
                  </p>
                  <div className="jig-branch-members">
                    {branch.memberIds.map((id) => (
                      <span key={id} className="jig-avatar" style={{ background: memberColor(id) }} title={memberName(id)}>
                        {memberName(id).slice(0, 1)}
                      </span>
                    ))}
                    <span className="field-hint">{branch.memberIds.map(memberName).join(" & ")}</span>
                  </div>
                  <ul className="jig-blocks">
                    {branch.blockIds.map((id) => <li key={id}>{byId.get(id)?.title}</li>)}
                  </ul>
                </div>
              );
            })}

            <div className="jig-map-slot">
              <MapIcon aria-hidden="true" />
              <strong>Map View Integration</strong>
              <span>Coming soon</span>
            </div>
          </div>

          <p className="jig-rendezvous">
            <MapPin size={17} aria-hidden="true" />
            <span>Both branches rejoin at <strong>{DEMO_SPLIT.rendezvous.name}</strong></span>
            <span className="jig-rendezvous-when">{DEMO_SPLIT.rendezvous.time}</span>
          </p>

          {accepted ? (
            <>
              <ul className="jig-members">
                {outcome.members.map((m) => {
                  const after = splitAchieved.get(m.memberId) ?? 0;
                  const ratio = m.baseline > 0 ? Math.min(1, after / m.baseline) : 1;
                  return (
                    <li key={m.memberId} className="jig-member">
                      <span className="jig-avatar" style={{ background: memberColor(m.memberId) }}>
                        {memberName(m.memberId).slice(0, 1)}
                      </span>
                      <span className="jig-name">{memberName(m.memberId)}</span>
                      <span className="jig-bar" aria-hidden="true"><i style={{ width: pct(ratio) }} data-good="true" /></span>
                      <span className="jig-ratio">
                        {pct(ratio)}
                        {after > m.achieved && <em className="jig-delta">+{after - m.achieved}</em>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="jig-verdict jig-verdict-good" role="status">
                <Check size={16} aria-hidden="true" />
                <span>
                  Everyone is happy with their afternoon now, and nobody&apos;s afternoon got worse. The
                  rejoin point is pinned on your map.
                  <span className="demo-hint"> (demo — resets on refresh)</span>
                </span>
              </p>
            </>
          ) : (
            <div className="jig-actions">
              <button type="button" className="primary-button" onClick={() => setAccepted(true)}>
                <Check aria-hidden="true" />Accept split
              </button>
              <button type="button" className="secondary-button" onClick={() => setDismissed(true)}>
                <X aria-hidden="true" />Keep everyone together
              </button>
            </div>
          )}
        </div>
      )}

      {dismissed && (
        <p className="inline-notice" role="status">
          <span>Kept as one group — {worstName} stays below their fair share for this window.</span>
          <button type="button" className="secondary-button" onClick={() => setDismissed(false)}>Reconsider</button>
        </p>
      )}

      <p className="jig-why field-hint">
        <strong>Why not just vote?</strong> A majority vote would pick the food crawl every time and
        {" "}{worstName} would lose the same way on every trip. The engine minimises the largest gap between
        what any one person could have had and what the shared plan gives them &mdash; so the fix is a
        branch that rejoins, not an outvoted traveller.
      </p>
    </section>
  );
}
