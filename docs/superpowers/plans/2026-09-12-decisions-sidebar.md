# Decisions Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a prototype-only "Decisions" trip sidebar page that collects the existing chat discovery-signal/safety-constraint fixtures and every individual Timeline change saved, each requiring the viewer to Agree/Disagree and give a 1–5 star rating.

**Architecture:** Extend the existing `DemoTripStateProvider` (already the shared cross-page state for the prototype's chat thread) with a `decisions` list and two actions. A new `DecisionCard` renders one entry (Agree/Disagree → reveal a 5-star picker → clicking a star finalizes it). A new `DemoDecisions` list + `/trips/[tripId]/decisions` page + sidebar nav entry render them. `DemoTimeline`'s existing `saveChanges()` pushes one decision per already-tracked `PendingChange`. The chat pane's inline signal panel and its now-orphaned `ChatSignalCard` are removed.

**Tech Stack:** Next.js (App Router), React (client components), TypeScript, Vitest + Testing Library (jsdom), lucide-react icons. No database changes — everything is local React state, matching how the chat/timeline prototype already behaves (resets on refresh).

**Spec:** [`docs/superpowers/specs/2026-09-12-decisions-sidebar-design.md`](../specs/2026-09-12-decisions-sidebar-design.md)

## Global Constraints

- Prototype/demo-only: no migration, no Supabase table, no API route (spec §1 "Out of scope").
- A decision has exactly one response (the single demo viewer "You"), never per-member tallying (spec §1).
- One decision per individual `PendingChange` on Save, not one batched card per Save click (spec §1, confirmed by user).
- Agree/Disagree + rating is feedback only — it must not alter the actual plan, revert a timeline change, or apply a signal's real effect (spec §1).
- The real (non-`isPrototype()`) branch of the new route calls `notFound()`, matching Map/Budget/etc. (spec §3).

---

### Task 1: Decision data model in `DemoTripStateProvider`

**Files:**
- Modify: `features/prototype/demo-trip-state.tsx`
- Test: Create `tests/components/demo-trip-state.test.tsx`

**Interfaces:**
- Consumes: `DEMO_SIGNALS` from `lib/prototype/fixtures.ts` (existing; `{ id, kind: "soft"|"hard-candidate", label, quote, forMemberId, forMemberName, expiresInDays, detail }[]`).
- Produces (used by every later task):
  ```ts
  export type DecisionSource = "signal" | "timeline";
  export type DecisionResponse = { agree: boolean; stars: 1 | 2 | 3 | 4 | 5 };
  export type Decision = {
    id: string;
    source: DecisionSource;
    kind?: "soft" | "hard-candidate";
    title: string;
    detail: string;
    forMemberName?: string | null;
    expiresInDays?: number | null;
    createdAt: string;
    response: DecisionResponse | null;
  };
  ```
  `useDemoTripState()` gains `decisions: Decision[]`, `addTimelineDecision: (change: { text: string }) => void`, `respondToDecision: (id: string, response: DecisionResponse) => void`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/demo-trip-state.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoTripStateProvider, useDemoTripState } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

function Probe() {
  const { decisions, addTimelineDecision, respondToDecision } = useDemoTripState();
  return (
    <div>
      <p data-testid="count">{decisions.length}</p>
      <ul>
        {decisions.map((d) => (
          <li key={d.id}>
            {d.source}:{d.title}:{d.response ? `${d.response.agree}-${d.response.stars}` : "pending"}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => addTimelineDecision({ text: "Test change" })}>add</button>
      <button type="button" onClick={() => respondToDecision(decisions[0]?.id, { agree: true, stars: 5 })}>
        respond-first
      </button>
    </div>
  );
}

function renderProbe() {
  return render(<DemoTripStateProvider><Probe /></DemoTripStateProvider>);
}

describe("useDemoTripState decisions", () => {
  it("seeds decisions from the demo signal fixtures", () => {
    renderProbe();
    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(screen.getByText(/signal:live jazz:pending/)).toBeInTheDocument();
    expect(screen.getByText(/signal:no shellfish:pending/)).toBeInTheDocument();
  });

  it("appends a timeline decision via addTimelineDecision", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByTestId("count")).toHaveTextContent("4");
    expect(screen.getByText(/timeline:Test change:pending/)).toBeInTheDocument();
  });

  it("records a response via respondToDecision", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole("button", { name: "respond-first" }));
    expect(screen.getByText(/true-5/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/demo-trip-state.test.tsx`
Expected: FAIL — `decisions`/`addTimelineDecision`/`respondToDecision` don't exist on the context value yet (TypeScript/runtime error, or `decisions` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `features/prototype/demo-trip-state.tsx` with:

```tsx
"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ChatEntry } from "@/features/chat/use-trip-channel";
import type { ChatAuthorKind } from "@/lib/chat/repository";
import { DEMO_CHAT_MESSAGES, DEMO_SELF_MEMBER_ID, DEMO_SIGNALS, DEMO_TRIP_ID } from "@/lib/prototype/fixtures";

export type DecisionSource = "signal" | "timeline";

export type DecisionResponse = { agree: boolean; stars: 1 | 2 | 3 | 4 | 5 };

export type Decision = {
  id: string;
  source: DecisionSource;
  /** Only meaningful for source: "signal" -- drives ChatSignalCard-style styling/copy. */
  kind?: "soft" | "hard-candidate";
  title: string;
  detail: string;
  forMemberName?: string | null;
  expiresInDays?: number | null;
  createdAt: string;
  response: DecisionResponse | null;
};

type DemoTripState = {
  messages: ChatEntry[];
  /** Appends a message as if it were just sent -- used both for the composer's own send and for
   * anything elsewhere in the prototype (e.g. the Timeline's Save button) that needs to post into
   * the same seeded thread. */
  postMessage: (body: string, authorKind?: ChatAuthorKind) => void;
  decisions: Decision[];
  /** Timeline's Save calls this once per pending change (one decision per change, not one per
   * Save click). */
  addTimelineDecision: (change: { text: string }) => void;
  /** The Decisions page calls this once the viewer finalizes a card (agree/disagree + stars are
   * always set together -- there is no partially-resolved decision). */
  respondToDecision: (id: string, response: DecisionResponse) => void;
};

const DemoTripStateContext = createContext<DemoTripState | null>(null);

function signalToDecision(signal: (typeof DEMO_SIGNALS)[number]): Decision {
  return {
    id: signal.id,
    source: "signal",
    kind: signal.kind,
    title: signal.label,
    detail: signal.detail,
    forMemberName: signal.forMemberName,
    expiresInDays: signal.expiresInDays,
    createdAt: new Date(0).toISOString(),
    response: null,
  };
}

/**
 * Shares the prototype's chat thread and decision queue across routes within one trip. Each
 * /trips/[tripId]/* page is its own React tree, mounted and unmounted as the user switches tabs --
 * without this sitting above them in the layout (which Next.js keeps mounted across those tab
 * switches), a message posted from, say, the Timeline's Save button (or a decision it creates)
 * would have nowhere durable to land, and DemoChat's / DemoDecisions' own local state would forget
 * it the moment the user navigated away and back.
 */
export function DemoTripStateProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatEntry[]>(() => DEMO_CHAT_MESSAGES.map((m) => ({ ...m })));
  const [decisions, setDecisions] = useState<Decision[]>(() => DEMO_SIGNALS.map(signalToDecision));

  const postMessage = useCallback((body: string, authorKind: ChatAuthorKind = "member") => {
    setMessages((prev) => [...prev, {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tripId: DEMO_TRIP_ID,
      authorMemberId: authorKind === "member" ? DEMO_SELF_MEMBER_ID : null,
      authorKind,
      body,
      proposalId: null,
      createdAt: new Date().toISOString(),
    }]);
  }, []);

  const addTimelineDecision = useCallback((change: { text: string }) => {
    setDecisions((prev) => [...prev, {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "timeline",
      title: change.text,
      detail: "A change made on the Timeline.",
      forMemberName: null,
      expiresInDays: null,
      createdAt: new Date().toISOString(),
      response: null,
    }]);
  }, []);

  const respondToDecision = useCallback((id: string, response: DecisionResponse) => {
    setDecisions((prev) => prev.map((d) => (d.id === id ? { ...d, response } : d)));
  }, []);

  const value = useMemo(
    () => ({ messages, postMessage, decisions, addTimelineDecision, respondToDecision }),
    [messages, postMessage, decisions, addTimelineDecision, respondToDecision],
  );
  return <DemoTripStateContext.Provider value={value}>{children}</DemoTripStateContext.Provider>;
}

export function useDemoTripState(): DemoTripState {
  const context = useContext(DemoTripStateContext);
  if (!context) throw new Error("useDemoTripState must be used within DemoTripStateProvider");
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/demo-trip-state.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add features/prototype/demo-trip-state.tsx tests/components/demo-trip-state.test.tsx
git commit -m "feat(prototype): add decision queue to DemoTripStateProvider"
```

---

### Task 2: `DecisionCard` component

**Files:**
- Create: `features/prototype/decision-card.tsx`
- Modify: `app/globals.css` (append after the existing `.signal-card` block, currently ending at line 1576 — exact insertion point confirmed in Task 5, which removes that block; inserting here first keeps this task's diff additive-only)
- Test: Create `tests/components/decision-card.test.tsx`

**Interfaces:**
- Consumes: `Decision`, `DecisionResponse` from `features/prototype/demo-trip-state.tsx` (Task 1).
- Produces: `DecisionCard({ decision: Decision, onRespond: (id: string, response: DecisionResponse) => void })`, used by Task 3's `DemoDecisions`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/decision-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionCard } from "@/features/prototype/decision-card";
import type { Decision } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

const SOFT_SIGNAL: Decision = {
  id: "sig-1", source: "signal", kind: "soft", title: "live jazz",
  detail: "A soft discovery signal.", forMemberName: null, expiresInDays: 3,
  createdAt: "2026-01-01T00:00:00.000Z", response: null,
};

const HARD_SIGNAL: Decision = {
  id: "sig-2", source: "signal", kind: "hard-candidate", title: "no shellfish",
  detail: "A possible hard safety constraint.", forMemberName: "Arun", expiresInDays: null,
  createdAt: "2026-01-01T00:00:00.000Z", response: null,
};

const TIMELINE_CHANGE: Decision = {
  id: "chg-1", source: "timeline", title: "Street of Harmony walk moved to 10:00–12:00 on 2026-10-03",
  detail: "A change made on the Timeline.", forMemberName: null, expiresInDays: null,
  createdAt: "2026-01-01T00:00:00.000Z", response: null,
};

describe("DecisionCard", () => {
  it("labels a soft signal as a discovery signal", () => {
    render(<DecisionCard decision={SOFT_SIGNAL} onRespond={vi.fn()} />);
    expect(screen.getByText("Discovery signal")).toBeInTheDocument();
  });

  it("labels a hard-candidate signal as a possible safety constraint, addressed to its member", () => {
    render(<DecisionCard decision={HARD_SIGNAL} onRespond={vi.fn()} />);
    expect(screen.getByText("Possible safety constraint")).toBeInTheDocument();
    expect(screen.getByText(/for Arun/)).toBeInTheDocument();
  });

  it("labels a timeline-sourced decision without signal-only chrome", () => {
    render(<DecisionCard decision={TIMELINE_CHANGE} onRespond={vi.fn()} />);
    expect(screen.getByText("Timeline change")).toBeInTheDocument();
    expect(screen.queryByText(/for /)).not.toBeInTheDocument();
  });

  it("reveals a star picker after Agree, and reports the pick", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<DecisionCard decision={SOFT_SIGNAL} onRespond={onRespond} />);

    await user.click(screen.getByRole("button", { name: "Agree" }));
    expect(screen.queryByRole("button", { name: "Agree" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rate 4 stars" }));

    expect(onRespond).toHaveBeenCalledWith("sig-1", { agree: true, stars: 4 });
  });

  it("reveals a star picker after Disagree, and reports the pick", async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<DecisionCard decision={SOFT_SIGNAL} onRespond={onRespond} />);

    await user.click(screen.getByRole("button", { name: "Disagree" }));
    await user.click(screen.getByRole("button", { name: "Rate 1 star" }));

    expect(onRespond).toHaveBeenCalledWith("sig-1", { agree: false, stars: 1 });
  });

  it("shows the resolved summary once a response exists, with no actions left", () => {
    const resolved: Decision = { ...SOFT_SIGNAL, response: { agree: true, stars: 4 } };
    render(<DecisionCard decision={resolved} onRespond={vi.fn()} />);
    expect(screen.getByText(/you agreed/i)).toBeInTheDocument();
    expect(screen.getByLabelText("4 out of 5 stars")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rate/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/decision-card.test.tsx`
Expected: FAIL — `features/prototype/decision-card.tsx` does not exist yet (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `features/prototype/decision-card.tsx`:

```tsx
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
```

Append to `app/globals.css` (after the existing `/* Chat preference extraction ... */` `.signal-*` block):

```css
/* Decisions page ------------------------------------------------------------- */
.decisions-list { list-style: none; margin: 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.decision-card { padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--canvas); }
.decision-card-hard { border-color: var(--flexible); background: var(--flexible-soft); }
.decision-card[data-status="disagreed"] { opacity: 0.6; }
.decision-card-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.decision-card-hard .decision-card-head { color: var(--flexible-dark); }
.decision-card-kind { font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }
.decision-card-expiry { margin-left: auto; font-variant-numeric: tabular-nums; }
.decision-card-label { margin: 6px 0 2px; font-size: 14px; font-weight: 600; font-family: var(--font-display); }
.decision-card-for { font-weight: 500; color: var(--muted); }
.decision-card-detail { margin: 4px 0 8px; }
.decision-card-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.decision-card-actions button { min-height: 34px; padding: 6px 10px; font-size: 12px; }
.decision-star-picker { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.decision-star-picker-label { font-size: 12px; color: var(--muted); margin-right: 4px; }
.decision-star-btn { padding: 4px; border: 0; background: none; color: var(--flexible); cursor: pointer; border-radius: 6px; }
.decision-star-btn:hover { background: var(--surface-2); }
.decision-star-row { display: inline-flex; align-items: center; gap: 1px; color: var(--flexible); vertical-align: middle; }
.decision-card-result { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--consensus); }
.decision-card[data-status="disagreed"] .decision-card-result { color: var(--muted); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/decision-card.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add features/prototype/decision-card.tsx tests/components/decision-card.test.tsx app/globals.css
git commit -m "feat(prototype): add DecisionCard (agree/disagree + 5-star rating)"
```

---

### Task 3: `DemoDecisions` list, page, and sidebar entry

**Files:**
- Create: `features/prototype/demo-decisions.tsx`
- Create: `app/trips/[tripId]/decisions/page.tsx`
- Modify: `components/app-shell.tsx:7-10` (icon import), `components/app-shell.tsx:21-31` (`TRIP_ITEMS`)
- Test: Create `tests/components/demo-decisions.test.tsx`

**Interfaces:**
- Consumes: `useDemoTripState()` (`decisions`, `respondToDecision`) from Task 1; `DecisionCard` from Task 2.
- Produces: `DemoDecisions` component, rendered by the new page; the page is reachable at `/trips/[tripId]/decisions`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/demo-decisions.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemoDecisions } from "@/features/prototype/demo-decisions";
import { DemoTripStateProvider } from "@/features/prototype/demo-trip-state";

afterEach(cleanup);

function renderDecisions() {
  return render(<DemoTripStateProvider><DemoDecisions /></DemoTripStateProvider>);
}

describe("DemoDecisions", () => {
  it("lists the seeded discovery signal and safety constraint", () => {
    renderDecisions();
    expect(screen.getByText(/live jazz/i)).toBeInTheDocument();
    expect(screen.getByText(/possible safety constraint/i)).toBeInTheDocument();
    expect(screen.getByText(/for Arun/i)).toBeInTheDocument();
  });

  it("resolves a decision after Agree then a star pick", async () => {
    const user = userEvent.setup();
    renderDecisions();
    const card = screen.getByText(/live jazz/i).closest("li")!;

    await user.click(within(card).getByRole("button", { name: "Agree" }));
    await user.click(within(card).getByRole("button", { name: "Rate 4 stars" }));

    expect(within(card).getByText(/you agreed/i)).toBeInTheDocument();
    expect(within(card).getByLabelText("4 out of 5 stars")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/demo-decisions.test.tsx`
Expected: FAIL — `features/prototype/demo-decisions.tsx` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `features/prototype/demo-decisions.tsx`:

```tsx
"use client";

import React from "react";
import { DecisionCard } from "@/features/prototype/decision-card";
import { useDemoTripState } from "@/features/prototype/demo-trip-state";

/**
 * Every signal picked up from chat and every Timeline change saved this session, newest first.
 * Local state only (see DemoTripStateProvider) -- nothing here changes the actual plan.
 */
export function DemoDecisions() {
  const { decisions, respondToDecision } = useDemoTripState();
  return (
    <ul className="decisions-list">
      {[...decisions].reverse().map((decision) => (
        <DecisionCard key={decision.id} decision={decision} onRespond={respondToDecision} />
      ))}
    </ul>
  );
}
```

Create `app/trips/[tripId]/decisions/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { DemoDecisions } from "@/features/prototype/demo-decisions";
import { isPrototype } from "@/lib/prototype/config";

// Feature: reviewable decision queue (chat signals + saved Timeline changes). Prototype-only,
// same shape as budget/page.tsx -- the real version has no backend yet.
export const dynamic = "force-dynamic";

export default async function TripDecisionsPage() {
  if (isPrototype()) return <DemoDecisions />;
  notFound();
}
```

In `components/app-shell.tsx`, change the icon import (line 6-10) to add `ClipboardCheck`:

```tsx
import {
  CalendarClock, ChevronDown, ClipboardCheck, Info, LayoutDashboard, ListChecks, LogOut, Luggage,
  Map as MapIcon, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Split,
  UserRound, Wallet, X,
} from "lucide-react";
```

And add a new entry to `TRIP_ITEMS` (line 21-31), right after `"timeline"`:

```tsx
const TRIP_ITEMS = [
  { key: "chat", label: "Chat", needsReady: false, icon: MessageCircle, demoOnly: false },
  { key: "plan", label: "Plan", needsReady: true, icon: ListChecks, demoOnly: false },
  { key: "timeline", label: "Timeline", needsReady: true, icon: CalendarClock, demoOnly: false },
  { key: "decisions", label: "Decisions", needsReady: false, icon: ClipboardCheck, demoOnly: true },
  { key: "map", label: "Map", needsReady: true, icon: MapIcon, demoOnly: true },
  { key: "jigsaw", label: "Split & merge", needsReady: true, icon: Split, demoOnly: true },
  { key: "budget", label: "Budget", needsReady: true, icon: Wallet, demoOnly: true },
  { key: "safety", label: "Food check", needsReady: true, icon: ShieldCheck, demoOnly: true },
  { key: "packing", label: "Packing", needsReady: true, icon: Luggage, demoOnly: true },
  { key: "entry", label: "Your prefs", needsReady: false, icon: UserRound, demoOnly: false },
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/demo-decisions.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add features/prototype/demo-decisions.tsx "app/trips/[tripId]/decisions/page.tsx" components/app-shell.tsx tests/components/demo-decisions.test.tsx
git commit -m "feat(prototype): add the Decisions page and its sidebar entry"
```

---

### Task 4: Wire Timeline Save into the decisions list

**Files:**
- Modify: `features/prototype/demo-timeline.tsx:45` (destructure `addTimelineDecision`), `features/prototype/demo-timeline.tsx:414-422` (`saveChanges`)
- Test: Modify `tests/components/demo-decisions.test.tsx` (add one test)

**Interfaces:**
- Consumes: `addTimelineDecision` from Task 1's `useDemoTripState()`; each existing `PendingChange` (`{ id, blockId, kind, text }`, unchanged).
- Produces: nothing new consumed elsewhere — this is the last producer feeding Task 3's `DemoDecisions`.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/demo-decisions.test.tsx` (add the import and the new `it`):

```tsx
import { DemoTimeline } from "@/features/prototype/demo-timeline";
```

```tsx
  it("adds a decision card when a Timeline change is saved", async () => {
    const user = userEvent.setup();
    render(
      <DemoTripStateProvider>
        <DemoTimeline />
        <DemoDecisions />
      </DemoTripStateProvider>,
    );

    const walk = screen.getByRole("button", { name: /^Street of Harmony walk,/ });
    walk.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.click(screen.getByRole("button", { name: /^save/i }));

    expect(screen.getByText(/timeline change/i)).toBeInTheDocument();
    expect(screen.getByText(/Street of Harmony walk moved to 10:00–12:00/)).toBeInTheDocument();
  });
```

(Place this inside the existing `describe("DemoDecisions", ...)` block, after the other two tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/demo-decisions.test.tsx`
Expected: FAIL — no decision is created (`saveChanges` doesn't call `addTimelineDecision` yet), so the new assertions find nothing.

- [ ] **Step 3: Write minimal implementation**

In `features/prototype/demo-timeline.tsx`, change line 45 from:

```tsx
  const { postMessage } = useDemoTripState();
```

to:

```tsx
  const { postMessage, addTimelineDecision } = useDemoTripState();
```

And change `saveChanges` (currently lines 414-422) from:

```tsx
  function saveChanges() {
    if (pendingChanges.length === 0) return;
    const lines = pendingChanges.map((c) => c.text);
    postMessage(lines.length === 1
      ? `Here's a change to the plan — ${lines[0]}. Let me know if that works.`
      : `A few changes to the plan: ${lines.join("; ")}. Let me know if those work.`);
    setPendingChanges([]);
    setAnnounce("Sent to the group chat");
  }
```

to:

```tsx
  function saveChanges() {
    if (pendingChanges.length === 0) return;
    const lines = pendingChanges.map((c) => c.text);
    postMessage(lines.length === 1
      ? `Here's a change to the plan — ${lines[0]}. Let me know if that works.`
      : `A few changes to the plan: ${lines.join("; ")}. Let me know if those work.`);
    pendingChanges.forEach((c) => addTimelineDecision({ text: c.text }));
    setPendingChanges([]);
    setAnnounce("Sent to the group chat");
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/demo-decisions.test.tsx`
Expected: PASS (3 tests)

Also run the existing Timeline suite to confirm nothing regressed:

Run: `npx vitest run tests/components/demo-timeline.test.tsx`
Expected: PASS (6 tests, unchanged)

- [ ] **Step 5: Commit**

```bash
git add features/prototype/demo-timeline.tsx tests/components/demo-decisions.test.tsx
git commit -m "feat(prototype): create a decision per Timeline change on Save"
```

---

### Task 5: Remove the inline signal panel from chat (now redundant)

**Files:**
- Modify: `features/prototype/demo-chat.tsx`
- Delete: `features/prototype/chat-signal-card.tsx`, `tests/components/chat-signal-card.test.tsx`
- Modify: `app/globals.css` (remove the now-unused `.signal-*` block)
- Test: Modify `tests/components/demo-chat.test.tsx` (add one regression test)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only removes the now-superseded inline panel and its sole consumer.

- [ ] **Step 1: Write the failing test**

In `tests/components/demo-chat.test.tsx`, add this test inside the existing `describe("DemoChat invite link", ...)` block (it can go anywhere in the block; placing it first is fine):

```tsx
  it("does not show the discovery-signal panel inline (moved to the Decisions page)", () => {
    renderDemoChat();
    expect(screen.queryByText(/From this chat the assistant picked up/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/demo-chat.test.tsx`
Expected: FAIL — the panel is still rendered today, so the query finds it.

- [ ] **Step 3: Write minimal implementation**

In `features/prototype/demo-chat.tsx`:

1. Remove the signal-panel JSX block (currently lines 97-106):

```tsx
      <details className="signal-panel" open>
        <summary className="signal-panel-head">
          <Search size={14} aria-hidden="true" />
          <span>From this chat the assistant picked up {DEMO_SIGNALS.length} things. Confirm what should shape the plan.</span>
          <ChevronDown className="collapse-chevron" size={16} aria-hidden="true" />
        </summary>
        <ul className="signal-list">
          {DEMO_SIGNALS.map((signal) => <ChatSignalCard key={signal.id} signal={signal} />)}
        </ul>
      </details>

```

(Delete this whole block; the `<Composer onSend={send} />` that followed it now comes directly after `<MessageList ... />`.)

2. Remove the now-unused imports. Change:

```tsx
import { ChevronDown, Search } from "lucide-react";
```

to nothing (delete the line — neither icon is used anywhere else in this file).

Change:

```tsx
import { ChatSignalCard } from "@/features/prototype/chat-signal-card";
```

to nothing (delete the line).

Change:

```tsx
import {
  DEMO_MEMBERS, DEMO_SELF_MEMBER_ID, DEMO_SIGNALS, DEMO_TRIP,
} from "@/lib/prototype/fixtures";
```

to:

```tsx
import { DEMO_MEMBERS, DEMO_SELF_MEMBER_ID, DEMO_TRIP } from "@/lib/prototype/fixtures";
```

Delete `features/prototype/chat-signal-card.tsx` and `tests/components/chat-signal-card.test.tsx` (its only consumer was the panel just removed, and its only other reference was its own test):

```bash
rm features/prototype/chat-signal-card.tsx tests/components/chat-signal-card.test.tsx
```

In `app/globals.css`, delete the now-unused block (currently the `/* Chat preference extraction ... */` comment through the end of the `.signal-card` rules, i.e. the 30 lines starting at `.signal-panel {` and ending at `.signal-card .demo-hint { display: inline; font-weight: 400; }`) — everything Task 2 placed its own `.decision-*` rules after.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/demo-chat.test.tsx`
Expected: PASS (5 tests)

Then run the full suite once to confirm the whole feature is consistent end to end:

Run: `npx vitest run`
Expected: PASS, and no test file still references `chat-signal-card` or `DEMO_SIGNALS` from `demo-chat.tsx`.

Also run: `npx tsc --noEmit`
Expected: no errors (confirms no dangling import of the deleted files anywhere).

- [ ] **Step 5: Commit**

```bash
git add -A features/prototype/demo-chat.tsx app/globals.css tests/components/demo-chat.test.tsx
git rm features/prototype/chat-signal-card.tsx tests/components/chat-signal-card.test.tsx
git commit -m "refactor(prototype): remove the inline chat signal panel, superseded by Decisions"
```
