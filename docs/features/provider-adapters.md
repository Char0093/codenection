# Feature: Provider Adapters

## Purpose

Provider adapters isolate third-party APIs from the product and domain logic. This lets MVP use real integrations where useful and mock integrations where reliability or cost matters.

## Adapter Rule

UI, route handlers, and domain modules must not call third-party APIs directly. They call typed provider interfaces only.

## Real MVP Adapters

- Google Maps JavaScript API for the web map.
- Google Places API (New) for transient place discovery/details.
- Google Routes API for route legs and travel-time matrices.
- Weather.
- Currency exchange rates.

## Mapping Provider Boundary

- Use Google Maps Platform end to end wherever Google map content is displayed. Do not combine
  Google Routes or Places content with Mapbox, OpenStreetMap, or another non-Google map.
- Browser map rendering uses a referrer-restricted public key. Places and Routes calls use a
  separate server-only key through typed provider adapters.
- Keep WanderSync-owned `poi_catalog` safety data separate from provider content. Google Places is
  not evidence of halal or allergen safety and is not copied wholesale into the permanent catalog.
- Attach provider, retrieval time, expiry, and attribution metadata to provider-derived results;
  enforce the current Google caching and display terms.
- `ComputeRouteMatrix` supplies travel costs to the Python optimizer. The optimizer remains the
  source of itinerary/subgroup decisions; Google supplies transport-network facts, not group policy.

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
- Realtime unavailable: fall back to polling so the workspace stays usable, and label live presence as stale.
- Mock booking unavailable: show demo/degraded status without blocking core trip planning.

## Non-Goals

- Provider-specific logic in React components.
- Calling Google Routes or Places without the corresponding Google display/content boundary. A
  future provider replacement must replace the complete mapping-content family or pass a legal
  compatibility review; adapter abstraction does not make cross-provider display permissible.
- Real booking or payment execution in MVP.
