# Feature: Itinerary Planning

## Purpose

The itinerary planner creates viable day plans using deterministic scoring and hard safety constraints.

## MVP Behavior

- Before generation, collect an explicit destination-local `available from`, preferred start, and
  optional `finish by` value for every trip day; offer common presets plus custom time and
  copy-to-all-days.
- Generate itinerary days from destination, dates, daily planning windows, budget, pace, member
  profiles, and candidate places.
- Include activities, meals, transit estimates, cost estimates, opening hours, intensity, accessibility fit, dietary fit, and weather suitability.
- Explain why each recommendation was selected or rejected.
- Surface conflicts instead of silently producing unsafe plans.
- Allow users to regenerate or manually move and resize itinerary items on a 24-hour Calendar-style
  timeline; represent required travel as separate blocks rather than hidden padding.
- Show one selected date at a time, switched from a date strip above the timeline. Do not display all
  trip days simultaneously.
- Provide a searchable POI choice pool categorized as Food, Nature, Shopping, Heritage, Culture,
  Entertainment, and Local/Wildcard. Users drag described POI cards into valid timeline slots or
  return scheduled blocks to the pool without deleting the underlying POI.
- Keep timeline descriptions to one line and provide full POI descriptions, sources, links, hours,
  safety evidence, and trust status in a details sheet.
- Keep post-onboarding preferences editable. Soft changes affect future suggestions immediately but
  never rewrite the active itinerary. A user may request a current-itinerary review, which produces
  a validated pending diff requiring confirmation.
- Route safety-critical preference changes through explicit confirmation and immediately mark any
  now-questionable active item for review without exposing the underlying private detail to the group.

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
- Hard daily availability/finish bounds and the soft preferred start.

## Hard Constraints

Reject candidates that conflict with:

- Severe allergies.
- Required accessibility accommodations.
- Closed opening hours.
- Immovable reservations or booked transport.
- Activity or transit outside the selected daily planning window.
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
