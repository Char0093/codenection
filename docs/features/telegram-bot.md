# Feature: Telegram Bot

## Purpose

The Telegram bot captures lightweight trip actions from group chat while preventing accidental state changes.

## MVP Commands

- `/start`: connect user or group to a trip.
- `/trip`: show current trip summary.
- `/expense`: create a pending expense.
- `/split`: propose subgroup split.
- `/merge`: propose merge recommendation.
- `/status`: show itinerary, ledger, and split state.

## Confirmation Rule

All actions that mutate trip state must go through pending confirmation:

- Expense creation.
- Split session activation.
- Merge instruction publication.
- Itinerary changes.
- Profile preference changes.

Unconfirmed bot events expire after a short retention window.

## Intent Parsing

Use rule-based extraction and simple classification for MVP. Detect possible preferences, constraints, and expense commands, but do not commit inferred data without confirmation.

Examples:

- "Too much walking" becomes a pending mobility/intensity preference.
- "Halal street food only" becomes a pending dietary preference.
- "Taxi was 25" becomes a pending expense suggestion.

## Data

Use:

- `bot_events`
- `trip_members`
- `expenses`
- `split_sessions`
- `member_profiles`

## Non-Goals

- Reading all historical Telegram messages.
- Fully autonomous chat mining.
- Private-message surveillance.
- Acting on jokes, sarcasm, memes, or ambiguous statements without confirmation.
