"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, CloudRain, Shirt, ShieldCheck } from "lucide-react";
import { DEMO_PACKING } from "@/lib/prototype/demo-features";
import { AnimatedCheckbox } from "@/components/animated-checkbox";

const GROUP_ICON: Record<string, typeof CloudRain> = {
  weather: CloudRain, dress: Shirt, safety: ShieldCheck,
};

/**
 * Feature: packing checklist. Every item carries the reason it exists — the forecast, a venue's
 * dress code, or a confirmed safety requirement — so the list is auditable rather than generic.
 * Ticks are local state.
 */
export function PackingView() {
  const [packed, setPacked] = useState<Set<string>>(new Set());
  const allItems = useMemo(() => DEMO_PACKING.flatMap((g) => g.items), []);

  function toggle(id: string) {
    setPacked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <section className="pack-view">
      <div className="section-heading">
        <div>
          <h1>Packing list</h1>
          <p className="field-hint">
            Built from this trip&apos;s forecast, the venues on the itinerary, and confirmed safety needs.
          </p>
        </div>
        <span className="pack-count">{packed.size}/{allItems.length}</span>
      </div>
      <p className="demo-hint">Demo — the list is generated from the sample trip; ticks reset on refresh.</p>

      {DEMO_PACKING.map((group) => {
        const Icon = GROUP_ICON[group.id] ?? CloudRain;
        const done = group.items.filter((i) => packed.has(i.id)).length;
        return (
          <details key={group.id} className="pack-group" open>
            <summary className="pack-group-head">
              <Icon size={15} aria-hidden="true" />
              <h2>{group.title}</h2>
              <span className="pack-group-count">{done}/{group.items.length}</span>
              <ChevronDown className="collapse-chevron" size={16} aria-hidden="true" />
            </summary>
            <p className="pack-source">{group.source}</p>
            <ul>
              {group.items.map((item) => (
                <li key={item.id} className="pack-item" data-done={packed.has(item.id) ? "true" : undefined}>
                  <AnimatedCheckbox
                    checked={packed.has(item.id)}
                    onChange={() => toggle(item.id)}
                    label={
                      <span className="pack-item-text">
                        <strong>{item.label}</strong>
                        <span className="field-hint">{item.reason}</span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
