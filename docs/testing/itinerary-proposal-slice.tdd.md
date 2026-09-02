# Itinerary Proposal Slice: TDD Evidence

## Source

The user-approved slice was derived from `Implementation_Plan.md`, `docs/features/member-profiles.md`, `docs/features/itinerary-planning.md`, and `docs/agentic-architecture.md`.

## User Journeys

- As a trip owner, I can see unresolved consent before generating a plan so private profile data is not used silently.
- As a traveler with a severe allergy or accessibility requirement, I am protected from incompatible recommendations.
- As a trip owner, I can review explanations and conflicts before activating an agent proposal.
- As a group, we can use the complete workflow in local demo mode before Supabase credentials are configured.

## RED And GREEN Evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `npm test -- tests/domain/itinerary.test.ts` | Expected failure | Vitest loaded the new suite and failed because `lib/domain/itinerary` did not exist. |
| GREEN | `npm test -- tests/domain/itinerary.test.ts` | PASS | 7 initial itinerary and proposal tests passed after the minimal domain implementation. |
| Expanded GREEN | `npm test` | PASS | 13 tests pass across 2 test files after edge-case coverage was added. |
| Coverage | `npm run test:coverage` | PASS | 98.3% statements, 95.55% branches, 100% functions, and 98.3% lines for `lib/domain`. |
| Static checks | `npm run lint` | PASS | ESLint completed without findings. |
| Production build | `npm run build` | PASS | Next.js compiled, type-checked, and prerendered `/` successfully. |

## Test Guarantees

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Pending consent prevents profile-based recommendations. | `evaluateCandidate` pending-consent test | Unit | PASS |
| 2 | Severe allergy conflicts reject a candidate regardless of score. | `evaluateCandidate` allergy test | Unit | PASS |
| 3 | Missing accessibility features reject a candidate. | `evaluateCandidate` accessibility test | Unit | PASS |
| 4 | Closed candidates cannot enter a proposal. | `evaluateCandidate` opening-hours test | Unit | PASS |
| 5 | Budget, pace, travel time, weather, and halal status produce auditable reasons. | `evaluateCandidate` scoring tests | Unit | PASS |
| 6 | Rejected candidates remain visible as proposal conflicts. | `generateItineraryProposal` test | Unit | PASS |
| 7 | Only a pending proposal reviewed by an owner or planner can be activated. | `confirmProposal` tests | Unit | PASS |
| 8 | The trip date range rejects an end date before its start date. | `validateTripDates` tests | Unit | PASS |

## Browser Evidence

The local app was exercised in the in-app browser at desktop and 390 px mobile widths.

- Initial proposal generation was disabled with one unresolved consent.
- Granting Daniel's consent exposed the confirmed `step_free` requirement and enabled generation.
- Generation produced 3 viable stops and retained 2 rejected candidates.
- The rejected candidates showed the accessibility, severe-allergy, and halal blockers.
- Owner approval changed the proposal from `pending` to `accepted` and displayed the confirmation result.
- Overview, People, and Itinerary had no horizontal overflow at 390 px; headings and controls fit their containers.
- No browser console errors or warnings were recorded.

## Security Review

- No credentials, dangerous HTML rendering, or direct SQL interpolation was introduced.
- All six new Supabase tables enable RLS.
- Constraint writes require the authenticated member ID and constraint trip ID to match the same membership row.
- Itinerary and destination writes require owner or planner membership.
- Agent jobs are read-only to members; proposal confirmation is restricted to owners and planners.
- `npm audit` reported zero known vulnerabilities after adding the coverage provider.

## Known Gaps

- The migration was not executed because no Supabase CLI or linked project is available in this checkout.
- Browser coverage is recorded as manual automation evidence; Playwright is not yet installed as a committed E2E test runner.
- Demo persistence uses browser-local synthetic data. Production profile persistence remains behind the Supabase/RLS integration boundary.
