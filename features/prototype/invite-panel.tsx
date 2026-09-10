"use client";

import React, { useRef, useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { DEMO_TRIP, DEMO_TRIP_ID } from "@/lib/prototype/fixtures";

/** A short, opaque token so the demo link looks real. Nothing validates it -- the prototype has
 *  no backend -- so it is generated once per mount and never leaves the browser. */
function makeToken(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`;
  return raw.replace(/[^a-z0-9]/gi, "").slice(0, 10);
}

/** "Invite" control for the prototype chat header: a toggle that reveals a shareable link to the
 *  trip's member-entry screen, with one-tap copy. All state is local; no invite is persisted. */
export function InvitePanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [token] = useState(makeToken);
  const fieldRef = useRef<HTMLInputElement>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = `${origin}/trips/${DEMO_TRIP_ID}/entry?invite=${token}`;

  async function copy() {
    fieldRef.current?.select();
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      // Clipboard API blocked (insecure context, denied permission) -- fall back to the legacy path
      // on the already-selected field.
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="chat-invite">
      <button
        type="button"
        className="chat-invite-button"
        aria-label="Invite"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <UserPlus size={14} aria-hidden="true" />
        <span>Invite</span>
      </button>

      {open && (
        <div className="chat-invite-panel" role="dialog" aria-label="Invite people to this trip">
          <p className="chat-invite-hint">
            Anyone with this link can join <strong>{DEMO_TRIP.name}</strong>.
          </p>
          <div className="chat-invite-row">
            <label className="sr-only" htmlFor="chat-invite-link-field">Invite link</label>
            <input
              id="chat-invite-link-field"
              ref={fieldRef}
              className="chat-invite-link-field"
              type="text"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="secondary-button chat-invite-copy" onClick={copy}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
