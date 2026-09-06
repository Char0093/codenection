# Onboarding survey review fixes — TDD evidence

## Source

- Implementation plan: `docs/superpowers/plans/2026-09-06-onboarding-survey.md`
- Approved design: `docs/superpowers/specs/2026-09-06-onboarding-survey-slice-design.md`
- Review-fix RED checkpoint: `d3a27c3`
- Review-fix GREEN checkpoint: `ca215f8`

## User journeys

- A member can leave Quick mode and return to the full questionnaire without reloading.
- After a stale-write conflict, Reload replaces both the revision and confirmed/pending constraint metadata.
- Direct RPC callers receive `22023` for incomplete full submissions and fractional walking caps, with no partial writes.
- Completed profiles convert only exact persisted epsilon-grid values back to dial positions.

## RED and GREEN evidence

| Guarantee | Test target | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Missing full-mode fields are rejected by the RPC | `tests/database/onboarding-rls.test.ts` | Missing vibe/social role resolved successfully; missing pace raised `23502` | All missing fields raise `22023` and write nothing |
| Walking caps must be integers | `tests/database/onboarding-rls.test.ts` | `1.5` reached the integer cast and raised the wrong SQLSTATE | `1.5` is rejected as `22023` before casting |
| Quick mode has an exit path | `tests/components/onboarding-wizard.test.tsx` | Back was disabled on Quick step 1 | Back returns to full step 1 and clears Quick mode |
| Reload replaces constraint metadata | `tests/components/onboarding-wizard.test.tsx` | Fresh confirmed chips remained unlocked and fresh pending chips were absent | Confirmed/pending chips use the reseeded snapshot |
| Epsilon inverse is grid-only | `tests/domain/onboarding.test.ts` | `0.2` was silently rounded to dial 4 | `0.2` throws; all five grid values remain supported |

Targeted RED command:

```text
npm test -- tests/domain/onboarding.test.ts tests/components/onboarding-wizard.test.tsx tests/database/onboarding-rls.test.ts
Result: 7 failed, 52 passed
```

Targeted GREEN command:

```text
npm test -- tests/domain/onboarding.test.ts tests/components/onboarding-wizard.test.tsx tests/database/onboarding-rls.test.ts tests/components/travel-dna-nudge.test.tsx
Result: 63 passed
```

## Final verification

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 773 tests |
| `npm run test:coverage` | PASS — 99.45% statements, 95.3% branches, 100% functions, 99.45% lines; `lib/domain/onboarding.ts` 100% |
| `npm run build` | PASS |
| `git diff --check` | PASS |

## Known deferred scope

The preference editor, Group Conductor summary, realtime announcement, current-itinerary review flow, interest-vector embedding, confirmed-dealbreaker removal/supersession, and final image artwork remain deferred as documented in the approved slice design.
