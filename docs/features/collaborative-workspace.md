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

- Use a Google Calendar-style vertical day/week view covering the full destination-local
  00:00-24:00 day. Overnight hours may be collapsed initially but remain accessible.
- Each activity is a draggable block positioned by start time, with height proportional to its
  duration. Drag the block to change time/day; resize it from either edge in 15-minute increments.
  Pointer and keyboard users receive equivalent controls and start/end/duration announcements.
- Required travel appears as its own subordinate block between attractions, so a visually open gap
  never hides necessary transit time.
- A move or resize commits an optimistic local update, then a server-validated write; a rejected
  write rolls the block back with the reason. Fixed reservations and consensus anchors are locked
  unless an authorized user explicitly unlocks and confirms the change.
- Every edit is revalidated by opening hours, transit feasibility, the trip day's hard planning
  window, deterministic schedule rules, rendezvous deadlines, and the hard-constraint gate
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
