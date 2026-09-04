# Feature: Collaborative Trip Workspace

## Purpose

The workspace is the trip command center. It replaces the retired Telegram bot and Mini App with a
native, web-based, multi-user surface inside the Next.js app. Groups coordinate, plan, and adapt in
one place, with no second platform to install or link.

## Layout

A dual-pane interface scoped to a single trip (`/trips/[tripId]/workspace`):

```text
┌──────────────────────────────┬───────────────────────────────────────┐
│ Pane 1 — Group chat          │ Pane 2 — Itinerary flashcard timeline │
│                              │                                       │
│ Multi-user realtime messages │ Draggable activity cards by day       │
│ Avatars, presence, typing    │ Reorder / move across days            │
│ Embedded AI assistant        │ Live updates from other members       │
│ (@ai mention or slash entry) │ Pending vs. active card states        │
└──────────────────────────────┴───────────────────────────────────────┘
```

Below the tablet breakpoint the panes become tabs; the timeline is the default tab.

## Pane 1: Multi-user realtime chat

- Messages persist in Supabase and stream over a per-trip Realtime channel, `trip:{tripId}`.
- Every message shows the author's avatar, display name, and timestamp. Presence shows who is
  currently viewing the trip; typing indicators are ephemeral (presence payload only, never stored).
- Membership and visibility are enforced by RLS, not by the channel name. A client that subscribes to
  another trip's channel receives nothing it is not already authorized to read.
- The AI assistant participates as a distinguished non-human author. It answers only when addressed
  (an `@ai` mention or the assistant composer), never on every message.
- The assistant is given the trip context and recent chat window, and it can **propose** itinerary
  changes. It cannot mutate state: proposals render as inline cards that an authorized member accepts
  or dismisses. This is the same propose/confirm boundary the retired bot used.

## Pane 2: Interactive flashcard timeline

- Each itinerary activity is a draggable flashcard grouped under its day.
- Drag to reorder within a day or move an activity to another day. Drop commits an optimistic local
  update, then a server-validated write; a rejected write rolls the card back with the reason.
- Every reorder is revalidated by the deterministic schedule rules and the hard-constraint gate
  before it is persisted. A drag can be refused (overlap, midnight crossing, budget or dietary
  violation, anchor arrival missed) and the refusal reason is shown on the card.
- Card states are visually distinct: active, pending proposal, AI-suggested, and conflicted.
- Remote edits from other members animate into place over the same Realtime channel.

## Concurrency

- Itinerary writes carry the trip revision. A stale revision loses and the client refetches, so two
  members dragging at once cannot silently clobber each other.
- Chat messages are append-only and conflict-free.
- Presence and typing state are ephemeral and never authoritative.

## Confirmation rule

Unchanged from the retired bot specification, and now enforced in-app: any action that mutates trip
state — accepting an AI proposal, confirming an extracted constraint, creating an expense, activating
an itinerary — requires an explicit action by an authorized member. Chat text alone never mutates
state, and the assistant never activates a plan.

## Privacy

- Chat messages are trip-scoped under RLS and deleted with the trip.
- The assistant receives the trip context and a bounded recent-message window, never the full history
  of unrelated trips.
- Ingested chat is untrusted input. Constraints derived from it are proposals requiring confirmation,
  and prompt-injection resistance is a tested requirement.
