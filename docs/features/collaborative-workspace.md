# Feature: Collaborative Trip Workspace

## Purpose

The product opens on a chat-group home after onboarding. Each chat group is one trip, giving every
conversation a single authorization, planning, and history boundary. Selecting a group opens its
native web chat and planning workspace.

## Chat-group home

- `/chats` is the authenticated home after first-login Travel DNA.
- List only trips in which the current user has a `trip_members` row, ordered by recent message or
  trip activity. Provide a useful empty state and **Create chat group** action.
- A new group creates a name-only draft trip and its owner membership transactionally. Destination,
  dates, budget, and pace can be completed later; itinerary generation remains disabled until the
  required setup is valid.
- Do not create a separate `chat_groups` table. The `trips` row is the group and
  `chat_messages.trip_id` scopes its history.
- Invitation UI and delivery are deferred. A future invite is trip-scoped and accepting it creates
  one membership row; token design must be single-use, expiring, and stored hashed.

## Layout

A selected trip opens at `/trips/[tripId]/chat`. Chat, Plan, and Timeline share one left-side
navigation shell; the planning surface may continue to use `/trips/[tripId]/workspace` during the
route migration. Do not duplicate a Timeline/Jigsaw control in the top bar when the sidebar already
contains it.

The planning workspace is a dual-pane interface scoped to that single trip:

```text
┌──────────────────────────────┬───────────────────────────────────────┐
│ Pane 1 — Group chat          │ Pane 2 — Selected-day builder         │
│                              │                                       │
│ Multi-user realtime messages │ Categorized POI pool + 24h timeline   │
│ Avatars, presence, typing    │ Date switcher; one day at a time      │
│ Embedded AI assistant        │ Live updates from other members       │
│ (@ai mention or slash entry) │ Pending vs. active card states        │
└──────────────────────────────┴───────────────────────────────────────┘
```

Below the tablet breakpoint the panes become tabs; chat is the selected-trip entry tab.

## Pane 1: Multi-user realtime chat

- Messages persist in Supabase and stream over a per-trip Realtime channel, `trip:{tripId}`.
- Every message shows the author's avatar, display name, and timestamp. Presence shows who is
  currently viewing the trip; typing indicators are ephemeral (presence payload only, never stored).
- Membership and visibility are enforced by RLS, not by the channel name. A client that subscribes to
  another trip's channel receives nothing it is not already authorized to read.
- The AI assistant participates as a distinguished non-human author. It answers only when addressed
  (an `@ai` mention or the assistant composer), never on every message.
- The assistant is given only the selected trip context and a bounded recent chat window, and it can **propose** itinerary
  changes. It cannot mutate state: proposals render as inline cards that an authorized member accepts
  or dismisses. This is the same propose/confirm boundary the retired bot used.

## Pane 2: POI pool and single-day timeline

- Show a date strip above a Google Calendar-style vertical timeline. Render only the selected
  destination-local day from 00:00-24:00; switching dates preserves each day's edits and scroll
  position. Overnight hours may be collapsed initially but remain accessible.
- On desktop, place a searchable categorized POI pool beside the timeline; use a bottom drawer on
  narrow screens. Categories are Food, Nature, Shopping, Heritage, Culture, Entertainment, and
  Local/Wildcard.
- Pool cards show a short description, duration estimate, cost, travel time, opening status,
  safety/trust badges, and a details action. Full descriptions, sources, links, hours, and warnings
  live in the detail sheet; timeline blocks keep only a one-line description.
- Drag a pool card into a feasible slot to schedule it. Dragging an ordinary block back to the pool
  unschedules it without deleting the POI. Duplicate visits require explicit confirmation.
- Each activity is a draggable block positioned by start time, with height proportional to its
  duration. Drag within the selected day; resize from either edge in 15-minute increments.
  Pointer and keyboard users receive equivalent controls and start/end/duration announcements.
- Required travel appears as its own subordinate block between attractions, so a visually open gap
  never hides necessary transit time.
- A move or resize commits an optimistic local update, then a server-validated write; a rejected
  write rolls the block back with the reason. Fixed reservations and consensus anchors are locked
  unless an authorized user explicitly unlocks and confirms the change.
- Valid drop ranges reflect normalized Google Places opening hours when available. Closed periods
  reject the drop; missing hours produce a persistent unverified-hours warning rather than a false
  open claim.
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
