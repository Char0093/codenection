# Decisions sidebar — design

> Status: approved for implementation planning, 2026-09-12.
> Prototype/demo-only, per the classification decision below — no new migration,
> no new Supabase table, no real persistence.

## 1. Scope

### In scope

A new trip-scoped "Decisions" page that collects two kinds of prototype events into
one reviewable list, each requiring the viewer ("You", `DEMO_SELF_MEMBER_ID`) to
Agree or Disagree and then give a 1–5 star satisfaction rating:

- **Signals** — the existing chat preference-extraction fixtures (`DEMO_SIGNALS` in
  [`lib/prototype/fixtures.ts:302`](../../../lib/prototype/fixtures.ts)): discovery
  signals (`kind: "soft"`) and possible safety constraints (`kind: "hard-candidate"`).
  These currently render inline in the chat pane via
  [`ChatSignalCard`](../../../features/prototype/chat-signal-card.tsx) and
  [`demo-chat.tsx:97-106`](../../../features/prototype/demo-chat.tsx); that inline
  panel is removed and its content moves to the new page.
- **Timeline changes** — every individual entry already built by `DemoTimeline`'s
  `pendingChanges` list (`PendingChange` type,
  [`demo-timeline.tsx:35`](../../../features/prototype/demo-timeline.tsx)) becomes
  its own decision the moment Save is pressed. One decision per change, not one per
  Save batch.
- A new `TRIP_ITEMS` sidebar entry, "Decisions", in
  [`components/app-shell.tsx`](../../../components/app-shell.tsx).
- Tests: the new decision card/list, and updates to the existing `demo-chat` and
  `demo-timeline` tests for the removed panel and the new decisions produced on save.

### Out of scope

- Any real backend: no migration, no Supabase table, no API route. All state is
  local React state inside the existing `DemoTripStateProvider`, resets on refresh —
  matching how signals already behave today.
- Multi-member voting/tallying. The prototype only ever renders one viewpoint
  ("You"); a decision has exactly one response, not one per trip member.
- Any effect on the actual plan. Agreeing or disagreeing is recorded feedback only;
  it does not revert a timeline change or apply/reject a signal's real effect (the
  existing signal copy about the safety gate / suggestion nudging is presentational
  only in the prototype already — this doesn't change).
- The non-prototype app. Like Map, Split & merge, Budget, Food check, and Packing,
  the real (non-`isPrototype()`) branch of the new route calls `notFound()`.
- Jigsaw trilemma resolutions (`JigsawPanelProps.onResolve`) — that prop is
  currently unwired to anything and stays that way; it is not one of the two
  decision sources listed above and the user did not ask for it here.

## 2. Data model

Extends [`features/prototype/demo-trip-state.tsx`](../../../features/prototype/demo-trip-state.tsx),
which already centralizes shared prototype state across the trip's pages (today:
just `messages`). Adds:

```ts
type DecisionSource = "signal" | "timeline";

type Decision = {
  id: string;
  source: DecisionSource;
  /** Only meaningful for source: "signal" — carries the discovery-vs-safety styling
   *  and copy that ChatSignalCard already has today. */
  kind?: "soft" | "hard-candidate";
  title: string;          // signal.label, or the PendingChange's own `text`
  detail: string;         // signal's quote + detail, or a fixed timeline-change blurb
  forMemberName?: string; // hard-candidate signals only (e.g. "Arun")
  expiresInDays?: number | null; // signals only
  createdAt: string;
  response: { agree: boolean; stars: 1 | 2 | 3 | 4 | 5 } | null;
};

type DemoTripState = {
  messages: ChatEntry[];
  postMessage: (body: string, authorKind?: ChatAuthorKind) => void;
  decisions: Decision[];
  /** Timeline calls this once per PendingChange when Save is pressed. */
  addTimelineDecision: (change: { text: string }) => void;
  /** Decisions page calls this when the viewer finalizes a card. */
  respondToDecision: (id: string, response: { agree: boolean; stars: 1 | 2 | 3 | 4 | 5 }) => void;
};
```

`decisions` is seeded at provider init from `DEMO_SIGNALS`
([`fixtures.ts:302`](../../../lib/prototype/fixtures.ts)), mapped to `source: "signal"`
entries with `response: null`, mirroring how `messages` is seeded from
`DEMO_CHAT_MESSAGES` today ([`demo-trip-state.tsx:26`](../../../features/prototype/demo-trip-state.tsx)).

## 3. Component changes

- **`features/prototype/decision-card.tsx`** (new) — adapted from
  [`chat-signal-card.tsx`](../../../features/prototype/chat-signal-card.tsx): same
  head (icon + "Discovery signal" / "Possible safety constraint" label + expiry),
  same quote/detail copy for signals, plus a fixed detail blurb for timeline-change
  cards (e.g. "A change made on the Timeline."). Replaces Confirm/Edit/Reject with:
  - Pending: **Agree** / **Disagree** buttons only.
  - After either is clicked: that choice is locked in (visually highlighted) and a
    row of 5 star buttons appears in its place.
  - Clicking a star immediately finalizes the response (calls
    `respondToDecision(id, { agree, stars })`) — no separate submit step, consistent
    with the app's existing one-click tapback pattern.
  - Resolved: a result line, e.g. "You agreed · ★★★★☆" / "You disagreed · ★★☆☆☆",
    mirroring `signal-card-result`'s existing resolved state.
- **`features/prototype/demo-decisions.tsx`** (new) — page-level list, reads
  `decisions` from `useDemoTripState()`, renders one `DecisionCard` per entry
  (newest first), with an empty state ("No decisions yet") for a from-scratch trip.
- **`app/trips/[tripId]/decisions/page.tsx`** (new) — same prototype/`notFound()`
  shape as [`budget/page.tsx`](../../../app/trips/%5BtripId%5D/budget/page.tsx):
  ```ts
  if (isPrototype()) return <DemoDecisions />;
  notFound();
  ```
- **`components/app-shell.tsx`** — new `TRIP_ITEMS` entry, placed right after
  Timeline: `{ key: "decisions", label: "Decisions", needsReady: false, icon:
  ClipboardCheck, demoOnly: true }`.
- **`features/prototype/demo-chat.tsx`** — remove the `signal-panel` block
  (lines 97-106) and its now-unused `DEMO_SIGNALS`/`ChatSignalCard`/`Search`/
  `ChevronDown` imports.
- **`features/prototype/demo-timeline.tsx`** — `saveChanges()`
  ([`demo-timeline.tsx:414-422`](../../../features/prototype/demo-timeline.tsx))
  keeps posting its existing chat summary message unchanged, and additionally calls
  `addTimelineDecision({ text: c.text })` for each entry in `pendingChanges` before
  clearing it.

## 4. Interaction flow

1. Viewer opens **Decisions** from the trip sidebar.
2. Each pending card shows its source-specific copy and Agree/Disagree.
3. Clicking Agree or Disagree reveals a 5-star picker under that same card.
4. Clicking a star finalizes the response; the card collapses to its resolved
   summary line. Nothing else in the app reacts to the response (see Out of scope).
5. A new signal appearing in chat, or a Timeline Save, both add fresh pending cards
   to the top of the list without navigating the viewer there — the sidebar entry
   has no unread badge in this slice (not requested).

## 5. Testing

- New test file for `DecisionCard` (or folded into a `demo-decisions.test.tsx`):
  pending → Agree/Disagree → star → resolved-state text, for both a `soft` signal
  and a `hard-candidate` signal (copy differs).
- `demo-decisions.test.tsx`: signals are seeded and listed; saving a Timeline change
  elsewhere in the same provider tree produces a new card (can be tested by
  rendering `DemoTimeline` and `DemoDecisions` under the same
  `DemoTripStateProvider`, matching how `demo-chat.test.tsx` already shares state
  with the Timeline for its own assertions today).
- Update `tests/components/demo-chat.test.tsx`: remove any assertion on the
  in-chat signal panel.
- Update `tests/components/demo-timeline.test.tsx` (if it asserts on `saveChanges`'
  chat-message side effect): confirm the existing chat-message assertion still
  passes, and add that decisions are created too.
