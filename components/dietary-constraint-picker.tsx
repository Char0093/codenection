"use client";

import React, { useEffect, useState } from "react";
import { Utensils } from "lucide-react";
import { DIETARY_FLAGS, DIETARY_FLAG_LABELS, type DietaryFlag } from "@/lib/domain/constraints";

async function mutateFlag(tripId: string, flag: DietaryFlag, method: "POST" | "DELETE") {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/constraints`, {
    method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flag }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Unable to update dietary conditions (${response.status}).`);
  }
}

export function DietaryConstraintPicker({ tripId, flags, disabled }: {
  tripId: string; flags: readonly DietaryFlag[]; disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<DietaryFlag>>(() => new Set(flags));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSelected(new Set(flags)); }, [tripId, flags]);

  async function toggle(flag: DietaryFlag) {
    if (disabled || pending) return;
    const before = selected;
    const active = before.has(flag);
    const next = new Set(before);
    active ? next.delete(flag) : next.add(flag);
    setSelected(next);
    setPending(true);
    setError(null);
    try {
      await mutateFlag(tripId, flag, active ? "DELETE" : "POST");
    } catch (cause) {
      setSelected(before);
      setError(cause instanceof Error ? cause.message : "Unable to update dietary conditions.");
    } finally {
      setPending(false);
    }
  }

  return <fieldset className="dietary-field wide" disabled={disabled}>
    <legend><Utensils aria-hidden="true" />Dietary conditions</legend>
    <p className="field-hint">Tap what applies to you. Everyone on the trip sees the group&apos;s combined list.</p>
    <div className="flag-grid" role="group" aria-label="Dietary conditions">
      {DIETARY_FLAGS.map((flag) => <button key={flag} type="button" className="flag-chip"
        aria-pressed={selected.has(flag)} disabled={disabled || pending}
        onClick={() => void toggle(flag)}>
        {DIETARY_FLAG_LABELS[flag]}
      </button>)}
    </div>
    {error && <p className="error-notice" role="alert">{error}</p>}
  </fieldset>;
}
