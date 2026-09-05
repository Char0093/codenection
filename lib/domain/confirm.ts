/**
 * Task 3.5: the one reusable confirmation primitive every mutating flow (split/merge, expense,
 * detour, self-heal, track switch) is meant to share, instead of each rolling its own.
 *
 * Pure state-transition logic only -- no I/O, no clock reads beyond the `now` passed in. Where a
 * token is persisted (a database row, a signed value, an in-memory map) is entirely the caller's
 * choice; this module only knows how to create one and decide whether a given attempt to use it
 * is valid: single-use, actor-bound, and time-bounded.
 */

export type ConfirmationToken = {
  id: string;
  /** Only this actor may consume the token -- Section VI's authorized-actor check. */
  actorId: string;
  createdAt: number;
  expiresAt: number;
  /** Set once, the first time the token is successfully consumed. Never unset. */
  consumedAt: number | null;
};

export type ConfirmationRejection = "not_found" | "expired" | "wrong_actor" | "already_used";
export type ConfirmationResult =
  | { ok: true; token: ConfirmationToken }
  | { ok: false; reason: ConfirmationRejection };

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Step 1: propose. Issues a single-use token bound to one actor, valid for ttlMs. */
export function createConfirmationToken(actorId: string, now: number, ttlMs: number): ConfirmationToken {
  return { id: randomId(), actorId, createdAt: now, expiresAt: now + ttlMs, consumedAt: null };
}

/**
 * Step 2: the authorized-actor and single-use check, run before applying anything. Never mutates
 * the token -- call `consumeConfirmationToken` only after the guarded action actually succeeds,
 * so a failed apply leaves the token valid for a genuine retry.
 */
export function checkConfirmation(token: ConfirmationToken | undefined, actorId: string, now: number): ConfirmationResult {
  if (!token) return { ok: false, reason: "not_found" };
  if (token.consumedAt !== null) return { ok: false, reason: "already_used" };
  if (now > token.expiresAt) return { ok: false, reason: "expired" };
  if (token.actorId !== actorId) return { ok: false, reason: "wrong_actor" };
  return { ok: true, token };
}

/** Step 3: apply, then acknowledge -- consume marks the token spent so a replay is refused. */
export function consumeConfirmationToken(token: ConfirmationToken, now: number): ConfirmationToken {
  return { ...token, consumedAt: now };
}
