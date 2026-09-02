# Feature: Provider Adapters

## Purpose

Provider adapters isolate third-party APIs from the product and domain logic. This lets MVP use real integrations where useful and mock integrations where reliability or cost matters.

## Adapter Rule

UI, route handlers, and domain modules must not call third-party APIs directly. They call typed provider interfaces only.

## Real MVP Adapters

- Maps and geocoding.
- Weather.
- Currency exchange rates.
- Telegram Bot API.

## Mock MVP Adapters

- Flight status and delay monitoring.
- Hotel availability.
- Activity availability.
- Transit disruption.
- Price-drop alerts.

## Common Requirements

Every adapter should return:

- Structured data.
- Provider name.
- Timestamp.
- Confidence or freshness metadata when applicable.
- User-displayable fallback message for degraded responses.

Every provider call should emit a `provider_events` row for observability.

## Failure Behavior

- Weather unavailable: keep itinerary usable and label weather-sensitive recommendations as unverified.
- Currency unavailable: use last known rate if present, otherwise require manual rate entry.
- Maps unavailable: show saved coordinates and text instructions.
- Telegram unavailable: keep web UI fully usable.
- Mock booking unavailable: show demo/degraded status without blocking core trip planning.

## Non-Goals

- Provider-specific logic in React components.
- Hard dependency on a single maps, weather, or currency vendor.
- Real booking or payment execution in MVP.
