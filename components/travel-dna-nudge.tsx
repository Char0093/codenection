"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

const storageKey = (tripId: string) => `travel-dna-nudge-dismissed:${tripId}`;

export function TravelDnaNudge({ tripId }: { tripId: string }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(storageKey(tripId)) === "1");
    } catch {
      // sessionStorage unavailable: a new trip starts visible, then dismisses for this mount.
      setDismissed(false);
    }
  }, [tripId]);

  if (dismissed) return null;

  return (
    <div className="inline-notice travel-dna-nudge" role="status">
      <Sparkles aria-hidden="true" />
      <span>Complete your Travel DNA — about 60 seconds — for suggestions tuned to you.</span>
      <Link className="secondary-button" href={`/trips/${tripId}/onboarding`}>Start</Link>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => {
        try { sessionStorage.setItem(storageKey(tripId), "1"); } catch { /* ignore */ }
        setDismissed(true);
      }}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
