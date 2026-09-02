# Agentic Architecture Guardrails

## Purpose

This file defines how the Travel Planner MVP becomes agentic without drifting into unsafe autonomous execution. Agents may observe, reason, propose, score, summarize, and prepare actions. Agents must not silently mutate trip state when user confirmation is required.

## Agentic Product Principle

The system is a confirmation-first travel operations assistant:

- Agents produce recommendations and pending actions.
- Users approve state-changing decisions.
- Deterministic domain services execute approved actions.
- Every agent output is auditable and testable.

## Agent Roles

### Trip Planning Agent

Responsibilities:

- Generate candidate itineraries.
- Score activities, meals, buffers, and travel segments.
- Explain recommendations and conflicts.
- Suggest itinerary edits when weather, timing, or constraints change.

Allowed writes:

- Draft itinerary proposals.
- Conflict reports.
- Recommendation explanations.

Not allowed:

- Confirming itinerary changes.
- Ignoring hard allergy, accessibility, consent, or reservation constraints.

### Preference Extraction Agent

Responsibilities:

- Parse Telegram messages and profile notes for possible preferences or constraints.
- Classify signals such as pace, dietary preference, walking tolerance, budget concern, or desired activity type.
- Convert signals into pending confirmation events.

Allowed writes:

- `bot_events` with `status = 'pending_confirmation'`.
- Candidate `constraints` only after confirmation.

Not allowed:

- Persisting raw chat transcripts long-term.
- Inferring sensitive health, religion, disability, or allergy data without explicit confirmation.
- Acting on sarcasm, jokes, memes, or ambiguous messages.

### Coordination Agent

Responsibilities:

- Propose split plans.
- Check shared asset dependencies before split activation.
- Compare subgroup ETAs during merge.
- Recommend rendezvous anchors, micro-activities, delegation tasks, or direct routing to fixed commitments.

Allowed writes:

- Proposed `split_sessions`.
- ETA snapshots.
- Merge recommendations.

Not allowed:

- Activating split sessions without confirmation.
- Continuously tracking location in MVP.
- Overriding hard reservations.

### Ledger Agent

Responsibilities:

- Interpret expense commands.
- Suggest split method and participants.
- Normalize currencies through the exchange-rate provider.
- Generate settlement instructions.

Allowed writes:

- Pending expense events from Telegram.
- Confirmed web-created expenses.
- Derived settlement rows after explicit calculation.

Not allowed:

- Executing payments.
- Linking bank accounts.
- Finalizing Telegram-created expenses without confirmation.

### Contingency Agent

Responsibilities:

- Monitor weather, mocked booking feeds, mocked flight feeds, and mocked transit disruption feeds.
- Detect risks to itinerary feasibility.
- Propose Plan B options.

Allowed writes:

- Provider observations.
- Draft contingency recommendations.

Not allowed:

- Rebooking hotels, flights, or activities.
- Cancelling reservations.
- Contacting third parties automatically in MVP.

## Agent Runtime Pattern

Use a job-based orchestration model:

- Route handlers and server actions enqueue agent jobs.
- Agents read current trip state through typed query functions.
- Agents write proposals, events, and audit records through typed command functions.
- UI and Telegram confirmation callbacks execute approved domain mutations.

Recommended job types:

- `generate_itinerary`
- `extract_preference`
- `propose_split`
- `propose_merge`
- `normalize_expense`
- `compute_settlement`
- `monitor_contingencies`

Each job must store:

- `job_type`
- `trip_id`
- `trigger_source`
- `input_snapshot`
- `status`
- `result_summary`
- `error_message`
- `created_at`
- `completed_at`

Implementation can use Supabase tables and scheduled functions for MVP. Do not introduce a separate queue service unless required by deployment constraints.

## Required Additional Tables

Add these tables to the database structure when implementing the agentic layer.

### `agent_jobs`

Tracks asynchronous agent work.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid null references trips(id) on delete cascade`
- `job_type text not null`
- `trigger_source text not null`
- `status text not null default 'queued'`
- `input_snapshot jsonb not null default '{}'`
- `result_summary jsonb not null default '{}'`
- `error_message text null`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `created_at timestamptz not null default now()`

### `agent_proposals`

Stores proposed actions that need review or confirmation.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `trip_id uuid not null references trips(id) on delete cascade`
- `agent_job_id uuid null references agent_jobs(id) on delete set null`
- `proposal_type text not null`
- `status text not null default 'pending'`
- `title text not null`
- `summary text not null`
- `payload jsonb not null default '{}'`
- `risk_level text not null default 'low'`
- `requires_confirmation boolean not null default true`
- `confirmed_by_member_id uuid null references trip_members(id)`
- `confirmed_at timestamptz null`
- `rejected_at timestamptz null`
- `expires_at timestamptz null`
- `created_at timestamptz not null default now()`

Rules:

- Proposals that change itinerary, expense, profile, subgroup, or reservation state require confirmation.
- Confirmation handlers must validate permissions and hard constraints again before applying the proposal.

### `agent_eval_runs`

Tracks regression and capability checks for agent behavior.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `eval_name text not null`
- `agent_name text not null`
- `input_fixture jsonb not null default '{}'`
- `expected_result jsonb not null default '{}'`
- `actual_result jsonb not null default '{}'`
- `passed boolean not null`
- `failure_signature text null`
- `model_name text null`
- `token_estimate int null`
- `created_at timestamptz not null default now()`

## Human Confirmation Matrix

Always require confirmation for:

- Itinerary changes.
- Profile or constraint changes derived from chat.
- Expense creation from Telegram.
- Split activation.
- Merge instruction publication.
- Any recommendation involving fixed commitments or possible financial loss.

Confirmation optional for:

- Reordering draft recommendation candidates.
- Recomputing scores.
- Refreshing weather or exchange rates.
- Regenerating explanation text without changing state.

Never automate in MVP:

- Payments.
- Booking, rebooking, or cancellation.
- Emergency-service contact.
- Continuous background tracking.
- Long-term chat analysis without explicit scope.

## Evaluation Requirements

Every agent must have evals before feature completion.

Minimum evals:

- Preference extraction rejects ambiguous sarcasm.
- Preference extraction creates pending confirmation for clear dietary and mobility signals.
- Trip planning blocks severe allergy conflicts.
- Trip planning blocks inaccessible activities for members with hard accessibility requirements.
- Coordination agent selects correct merge bucket for ETA deltas.
- Ledger agent keeps Telegram expenses pending until confirmation.
- Contingency agent marks mocked provider data as mocked or degraded.

Store eval fixtures under `tests/fixtures/agents/` and keep them deterministic.

## Model and Cost Routing

Use the smallest model that meets quality requirements:

- Classification and extraction: low-cost model.
- Itinerary scoring and deterministic settlement: normal application code, not an LLM.
- Multi-step contingency explanation: mid-tier model.
- Architecture or cross-feature reasoning: high-tier model only when lower tiers fail.

Track model name, retries, token estimate, and failure signature for agent jobs where an LLM is used.

## Observability

Every agent run should expose:

- Trigger source.
- Inputs used.
- Provider calls made.
- Proposal generated.
- Confirmation outcome.
- Failure or fallback state.

Do not hide degraded provider states behind confident agent language.

## Non-Goals

- Fully autonomous travel execution.
- Self-modifying business rules.
- Agent memory outside the trip data model.
- Unbounded multi-agent planning loops.
- LLM-based settlement math.
- LLM-based enforcement of security rules.
