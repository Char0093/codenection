# Feature: Privacy and Safety

## Purpose

Privacy and safety rules protect sensitive traveler data and prevent the MVP from making unsafe or overconfident decisions.

## Consent

- Each member must explicitly consent before their profile or Telegram-derived preferences influence planning.
- Consent status must be visible on the dashboard.
- Members can revoke consent, update profile data, export data, or request deletion.

## Sensitive Data

Treat these as sensitive:

- Health conditions.
- Mobility constraints.
- Sensory sensitivities.
- Severe allergies.
- Religious dietary requirements.
- Emergency contact details.
- Location traces or rendezvous history.

## Storage Rules

- Persist confirmed structured preferences.
- Keep raw Telegram message content only in short-lived pending confirmation events.
- Apply RLS to all trip, profile, itinerary, ledger, bot, and provider data.
- Deleting a trip must remove or anonymize associated trip data according to the chosen retention policy.

## Safety Boundaries

- The app may recommend nearby emergency resources, but must not provide medical advice.
- The app must not automatically contact emergency services.
- The app must show uncertainty when provider data is missing, stale, or mocked.
- Hard blockers for severe allergies and accessibility must override optimization.

## Non-Goals

- HIPAA-grade medical record handling.
- Automated emergency dispatch.
- Legal, insurance, or liability adjudication.
- Continuous covert tracking.
