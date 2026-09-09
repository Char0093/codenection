"use client";

import React, { useMemo, useState } from "react";
import { Check, GitMerge, Split, TriangleAlert, Users, X } from "lucide-react";
import {
  MIN_SATISFACTION_RATIO, SPLIT_STDDEV_THRESHOLD, evaluateTeam, shouldSplitCut,
} from "@/lib/domain/jigsaw";
import {
  DEMO_JIGSAW_CANDIDATES, DEMO_JIGSAW_TOGETHER, DEMO_SPLIT, MEMBER_IDS,
  memberColor, memberName,
} from "@/lib/prototype/demo-features";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Feature: jigsaw conflict resolution. The numbers here are not written down — they come from
 * `lib/domain/jigsaw`'s `evaluateTeam` / `shouldSplitCut` run against the fixture candidates, so
 * the screen shows what the real fairness engine decides. Accepting the split is local state.
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
          <Users size={15} aria-hidden="true" />
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

        <p className={splitRecommended ? "jig-verdict jig-verdict-bad" : "jig-verdict"} role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          {splitRecommended
            ? `${worstName} gets ${pct((outcome.members.find((m) => m.memberId === outcome.worstMemberId)?.ratio) ?? 0)} of their own best afternoon — under the ${pct(MIN_SATISFACTION_RATIO)} fair share. Spread is ${outcome.stdDev.toFixed(1)}, past the split threshold of ${SPLIT_STDDEV_THRESHOLD}.`
            : "This plan is within everyone's fair share."}
        </p>
      </div>

      {/* Split suggestion */}
      {splitRecommended && !dismissed && (
        <div className="jig-card jig-card-split" data-accepted={accepted ? "true" : undefined}>
          <div className="jig-card-head">
            <Split size={15} aria-hidden="true" />
            <h2>{accepted ? "Split accepted" : "Suggested: split, then rejoin"}</h2>
          </div>

          <div className="jig-branches">
            {DEMO_SPLIT.branches.map((branch) => (
              <div key={branch.id} className="jig-branch">
                <p className="jig-branch-label">{branch.label}</p>
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
            ))}
          </div>

          <p className="jig-rendezvous">
            <GitMerge size={14} aria-hidden="true" />
            Both branches rejoin at <strong>{DEMO_SPLIT.rendezvous.name}</strong> at {DEMO_SPLIT.rendezvous.time}
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
                <Check size={14} aria-hidden="true" />
                Everyone is at or above their fair share, and nobody&apos;s afternoon got worse. The
                rendezvous anchor is now on the Map.
                <span className="demo-hint"> (demo — resets on refresh)</span>
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
