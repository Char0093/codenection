# Feature: Shared Ledger

## Purpose

The shared ledger records trip expenses, supports subgroup-aware cost attribution, converts currencies, and calculates minimal settlement transfers.

## MVP Behavior

- Add expenses from the workspace, via the chat assistant proposal or the ledger form.
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

## Chat Entry

Members can describe an expense in trip chat ("dinner 120, split four ways") and the assistant
proposes a structured entry. Chat- or assistant-created expenses must stay pending until an
authorized member confirms them in the workspace.

## Non-Goals

- Direct payment execution.
- Bank account linking.
- Tax/accounting export.
- Automatic payment-method capture in MVP.
