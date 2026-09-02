# Feature: Member Profiles

## Purpose

Member profiles capture constraints and preferences needed to keep recommendations viable for all travelers.

## MVP Behavior

- Each trip member has an explicit consent state before their profile can influence planning.
- Capture mobility constraints, chronic health notes, sensory sensitivities, severe allergies, dietary requirements, halal preference, language, budget tier, pace preference, emergency contact, and home currency.
- Distinguish hard blockers from preferences.
- Show profile completeness without exposing sensitive details unnecessarily.
- Allow members to update or delete their profile data.

## Hard Constraints

The planner must treat these as blockers:

- Severe allergy conflict.
- Accessibility incompatibility that prevents attendance.
- Fixed medical or mobility limitations that make timing/intensity unsafe.
- Missing consent for using profile data.

## Data

Use `member_profiles` for sensitive profile details and `trip_members` for membership, role, display name, and consent state.

## Privacy Rules

- Do not expose sensitive profile data outside authorized trip members.
- Do not infer health, religion, or disability data from Telegram chat without confirmation.
- Store derived confirmed preferences separately from raw chat content.

## Non-Goals

- Medical advice.
- Automated diagnosis.
- Insurance or liability workflows.
- Background location tracking for profile enrichment.
