# Feature: Itinerary Planning

## Purpose

The itinerary planner creates viable day plans using deterministic scoring and hard safety constraints.

## MVP Behavior

- Generate itinerary days from destination, dates, budget, pace, member profiles, and candidate places.
- Include activities, meals, transit estimates, cost estimates, opening hours, intensity, accessibility fit, dietary fit, and weather suitability.
- Explain why each recommendation was selected or rejected.
- Surface conflicts instead of silently producing unsafe plans.
- Allow users to regenerate or manually edit itinerary items.

## Scoring Inputs

- Budget fit.
- Pace fit.
- Travel time.
- Opening hours.
- Accessibility suitability.
- Allergy and dietary safety.
- Halal suitability.
- Weather suitability.
- Fixed reservations or transport commitments.

## Hard Constraints

Reject candidates that conflict with:

- Severe allergies.
- Required accessibility accommodations.
- Closed opening hours.
- Immovable reservations or booked transport.
- Missing consent for required member profile data.

## Data

Use:

- `destinations`
- `itinerary_days`
- `itinerary_items`
- `constraints`
- `provider_events`

## Domain Modules

Implement pure functions for:

- Candidate eligibility.
- Candidate scoring.
- Explanation generation.
- Day packing and ordering.
- Conflict detection.

## Non-Goals

- NP-hard global optimization.
- Fully autonomous booking.
- Personalized recommendations based on long-term user history.
- Guaranteeing accessibility details that providers do not supply.
