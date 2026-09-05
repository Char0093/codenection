# Feature: Map and Coordination

## Purpose

The map view grounds the trip in real places, routes, rendezvous anchors, and split/merge state.

## MVP Behavior

- Display itinerary items on a Google Maps JavaScript API vector/3D map with day filters and an
  accessible 2D fallback when WebGL/3D is unavailable.
- Show meeting points, subgroup routes, fallback basecamp, and semantic rendezvous anchors.
- Show walking/transit duration estimates when provider data is available.
- Degrade to saved coordinates and text instructions if route data is unavailable.
- Use Google Routes `ComputeRouteMatrix` for solver travel costs and `ComputeRoutes` for displayed
  walking, driving, cycling, and transit legs. Preserve Google attribution and required route warnings.

## Split Flow

- `/split` or dashboard action creates subgroups.
- Before activation, check shared asset dependencies such as hotspot, car keys, tickets, bags, or medication.
- Each subgroup receives its own route instructions and checkpoint time.
- Store the split session and subgroup assignments.

## Merge Flow

When merging, compare ETA deltas:

- `delta <= 20 minutes`: route early subgroup to an amenity-rich anchor point.
- `20 < delta <= 60 minutes`: suggest nearby zero-commitment micro-activities.
- `delta > 60 minutes`: suggest delegation tasks or routing directly to the next fixed commitment.

## Fallbacks

- For GPS drift, prefer semantic anchors such as floor, landmark, storefront, entrance, or counter.
- For signal loss, revert to fixed time at evening basecamp.
- For hard reservations, route delayed groups directly to the reservation venue.

## Data

Use:

- `subgroups`
- `split_sessions`
- `itinerary_items`
- `provider_events`

## Non-Goals

- Continuous background location tracking.
- Indoor positioning.
- Automatic emergency response.
- Optimization for unlimited nested subgroup trees.
