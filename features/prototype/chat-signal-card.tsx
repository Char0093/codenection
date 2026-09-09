"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, Pencil, Sparkles, X } from "lucide-react";
import type { DemoSignal } from "@/lib/prototype/fixtures";

type Status = "pending" | "confirmed" | "rejected";

/**
 * Feature: chat preference extraction. The assistant proposes a discovery signal it read out
 * of the group chat; nothing is applied until a human acts on this card. A `hard-candidate`
 * (a possible safety constraint) is styled as a warning and is explicitly addressed to one
 * member -- the assistant can never confirm it for them. All state is local to the demo.
 */
export function ChatSignalCard({ signal }: { signal: DemoSignal }) {
  const [status, setStatus] = useState<Status>("pending");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(signal.label);
  const hard = signal.kind === "hard-candidate";

  return (
    <li className={`signal-card${hard ? " signal-card-hard" : ""}`} data-status={status}>
      <div className="signal-card-head">
        <span className="signal-card-icon" aria-hidden="true">
          {hard ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
        </span>
        <span className="signal-card-kind">
          {hard ? "Possible safety constraint" : "Discovery signal"}
        </span>
        {signal.expiresInDays !== null && (
          <span className="signal-card-expiry">expires in {signal.expiresInDays}d</span>
        )}
      </div>

      <p className="signal-card-label">
        {editing ? (
          <input
            aria-label="Edit signal"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoFocus
          />
        ) : (
          <>&ldquo;{label}&rdquo;</>
        )}
        {signal.forMemberName && <span className="signal-card-for"> · for {signal.forMemberName}</span>}
      </p>

      <p className="signal-card-quote">Heard in chat: {signal.quote}</p>
      <p className="signal-card-detail field-hint">{signal.detail}</p>

      {status === "pending" ? (
        <div className="signal-card-actions">
          {editing ? (
            <button type="button" className="primary-button" onClick={() => { setEditing(false); setStatus("confirmed"); }}>
              <Check aria-hidden="true" />Save &amp; confirm
            </button>
          ) : (
            <>
              <button type="button" className="primary-button" onClick={() => setStatus("confirmed")}>
                <Check aria-hidden="true" />{hard ? `Confirm as ${signal.forMemberName ?? "member"}` : "Confirm"}
              </button>
              <button type="button" className="secondary-button" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />Edit
              </button>
              <button type="button" className="ghost-button" onClick={() => setStatus("rejected")}>
                <X aria-hidden="true" />Reject
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="signal-card-result" role="status">
          {status === "confirmed"
            ? hard
              ? `Confirmed — added to the safety gate; every food stop is re-checked.`
              : `Confirmed — shaping suggestions for this trip only.`
            : "Rejected — no effect on the plan."}
          <span className="demo-hint"> (demo — resets on refresh)</span>
        </p>
      )}
    </li>
  );
}
