"use client";

import React, { useState } from "react";
import { AlertTriangle, CalendarClock, Sparkles, Star } from "lucide-react";
import type { Decision, DecisionResponse } from "@/features/prototype/demo-trip-state";

const STARS = [1, 2, 3, 4, 5] as const;

function StarRow({ filled }: { filled: number }) {
  return (
    <span role="img" aria-label={`${filled} out of 5 stars`} className="decision-star-row">
      {STARS.map((n) => (
        <Star key={n} size={14} aria-hidden="true" fill={n <= filled ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

/**
 * One reviewable decision -- a chat discovery signal/safety constraint, or an individual Timeline
 * change saved this session. Pending: Agree/Disagree, then (after either) a 5-star picker; a star
 * click finalizes the response immediately, no separate submit step. Resolved decisions render a
 * static summary with no further actions. All state beyond the pending/disagree local UI toggle
 * lives in the caller's decisions list (see DemoTripStateProvider) -- this component never mutates
 * anything on its own.
 */
export function DecisionCard({ decision, onRespond }: {
  decision: Decision;
  onRespond: (id: string, response: DecisionResponse) => void;
}) {
  const [pendingChoice, setPendingChoice] = useState<"agree" | "disagree" | null>(null);
  const hard = decision.kind === "hard-candidate";
  const kindLabel = decision.source === "timeline"
    ? "Timeline change"
    : hard ? "Possible safety constraint" : "Discovery signal";
  const response = decision.response;
  const status = response === null ? "pending" : response.agree ? "agreed" : "disagreed";

  return (
    <li className={`decision-card${hard ? " decision-card-hard" : ""}`} data-status={status}>
      <div className="decision-card-head">
        <span className="decision-card-icon" aria-hidden="true">
          {decision.source === "timeline" ? <CalendarClock size={14} /> : hard ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
        </span>
        <span className="decision-card-kind">{kindLabel}</span>
        {decision.expiresInDays != null && (
          <span className="decision-card-expiry">expires in {decision.expiresInDays}d</span>
        )}
      </div>

      <p className="decision-card-label">
        &ldquo;{decision.title}&rdquo;
        {decision.forMemberName && <span className="decision-card-for"> · for {decision.forMemberName}</span>}
      </p>

      {decision.quote && <p className="decision-card-quote">Heard in chat: {decision.quote}</p>}

      <p className="decision-card-detail field-hint">{decision.detail}</p>

      {response === null ? (
        pendingChoice === null ? (
          <div className="decision-card-actions">
            <button type="button" className="primary-button" onClick={() => setPendingChoice("agree")}>Agree</button>
            <button type="button" className="ghost-button" onClick={() => setPendingChoice("disagree")}>Disagree</button>
          </div>
        ) : (
          <div className="decision-star-picker" role="group" aria-label="Rate your satisfaction">
            <span className="decision-star-picker-label">
              {pendingChoice === "agree" ? "Agreed" : "Disagreed"} — rate it:
            </span>
            {STARS.map((count) => (
              <button key={count} type="button" className="decision-star-btn"
                aria-label={`Rate ${count} star${count === 1 ? "" : "s"}`}
                onClick={() => onRespond(decision.id, { agree: pendingChoice === "agree", stars: count })}>
                <Star aria-hidden="true" size={16} />
              </button>
            ))}
          </div>
        )
      ) : (
        <p className="decision-card-result" role="status">
          You {response.agree ? "agreed" : "disagreed"} · <StarRow filled={response.stars} />
        </p>
      )}
    </li>
  );
}
