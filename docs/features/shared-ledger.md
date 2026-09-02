# Feature: Shared Ledger

## Purpose

The shared ledger records trip expenses, supports subgroup-aware cost attribution, converts currencies, and calculates minimal settlement transfers.

## MVP Behavior

- Add expenses from web UI or Telegram confirmation flow.
- Support local currency amount, paid-by member, category, note, receipt attachment, and exchange rate metadata.
- Split expenses equally, by custom weights, by declared budget tier, or by subgroup membership.
- Show per-person running balances in trip currency and each member home currency.
- Generate minimal-transfer settlement instructions on demand.

## Settlement Rules

- Normalize all expenses into the trip base currency.
- Calculate each member net position.
- Match debtors to creditors greedily by remaining balance to minimize transfers.
- Preserve original expense currency and rate source for auditability.

## Data

Use:

- `expenses`
- `expense_shares`
- `settlements`
- `trip_members`
- `subgroups`

## Telegram Commands

- `/expense 25 taxi`
- `/splitcost dinner 120`

Telegram-created expenses must be pending until confirmed with an inline button.

## Non-Goals

- Direct payment execution.
- Bank account linking.
- Tax/accounting export.
- Automatic payment-method capture in MVP.
