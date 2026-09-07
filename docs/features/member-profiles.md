# Feature: Member Profiles

## Purpose

Member profiles capture a reusable Travel DNA baseline plus trip-specific constraints needed to keep
recommendations viable for all travelers.

## MVP Behavior

- On first authenticated entry, require a 10-second global safety check before any trip UI: dietary,
  religious-access, allergy, and mobility dealbreakers, with an optional exploration dial. It then
  redirects to `/chats`.
- Returning users skip onboarding and can edit **My Travel Preferences** without repeating the wizard.
- Store only an optional exploration tolerance and other truly stable, user-editable defaults in a
  self-only `user_travel_profiles` row with optimistic concurrency. Do not store budget, pace, or
  destination interests as mandatory global answers.
- Store confirmed global dietary, religious-access, and mobility requirements as typed
  `user_travel_constraints` rows with an audit-preserving supersession path.
- Keep trip membership consent and explicit trip overrides separate from the global baseline.
- Collect budget, pace, arrival/departure availability, and destination-specific POI preferences
  when the person creates or joins a particular trip.
- Capture any chronic health notes, sensory sensitivities, emergency contact, or home currency only
  in the existing sensitive trip-member profile path when actually needed and consented.
- Distinguish hard blockers from preferences.
- Show global onboarding completion without exposing raw profile details to another member.
- Allow members to update or delete their profile data.

## Hard Constraints

The planner must treat the union of confirmed global requirements and confirmed trip-specific
requirements as blockers:

- Severe allergy conflict.
- Accessibility incompatibility that prevents attendance.
- Fixed medical or mobility limitations that make timing/intensity unsafe.
- Missing trip-level consent for using the user's profile in that trip.

## Data

Use `user_travel_profiles` and `user_travel_constraints` for the reusable self-only baseline.
Use `traveler_profiles` only as a compatibility source and for explicit per-trip overrides during
migration. Use `member_profiles` for sensitive trip-specific details and `trip_members` for
membership, role, display name, and consent state.

## Privacy Rules

- Global Travel DNA and global constraint rows are self-only under RLS. Do not expose raw values to
  other trip members; server planning receives only a narrow projection required for the active trip.
- Trip-sensitive profile data remains limited to its authorized trip and purpose.
- Do not infer health, religion, or disability data from trip chat without confirmation.
- Store derived confirmed preferences separately from raw chat content.

## Non-Goals

- Medical advice.
- Automated diagnosis.
- Insurance or liability workflows.
- Background location tracking for profile enrichment.
