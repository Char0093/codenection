/**
 * Fair-ledger debt simplification.
 *
 * Turns a pile of "who paid for whom" expenses into the fewest possible transfers. Six people
 * settling a weekend normally owe each other in a tangle; this collapses that to at most n-1
 * payments, so nobody sends three separate transfers to three separate people.
 *
 * All money is integer minor units (sen, cents). No floating point anywhere in this file: the
 * arithmetic that decides what someone owes must be exact and must never come from an LLM.
 */

export type Expense = {
  id: string;
  /** Member who actually paid. */
  payerId: string;
  /** Total in integer minor units. */
  amountMinor: number;
  /** Members the cost is shared between. Must be non-empty. */
  beneficiaryIds: readonly string[];
};

export type Transfer = { fromId: string; toId: string; amountMinor: number };

/**
 * Split an amount between beneficiaries so the parts always sum back to the total.
 * The remainder cents go to the earliest beneficiaries in the supplied order, which keeps the
 * split deterministic and auditable rather than losing a cent to rounding.
 */
export function splitEvenly(amountMinor: number, beneficiaryCount: number): number[] {
  if (beneficiaryCount <= 0) throw new Error("An expense needs at least one beneficiary.");
  if (!Number.isInteger(amountMinor)) throw new Error("Amounts must be integer minor units.");

  const sign = amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(amountMinor);
  const base = Math.floor(magnitude / beneficiaryCount);
  const remainder = magnitude - base * beneficiaryCount;

  return Array.from({ length: beneficiaryCount }, (_unused, index) =>
    sign * (base + (index < remainder ? 1 : 0)),
  );
}

/**
 * Net position per member: positive means the group owes them, negative means they owe the group.
 * Balances always sum to zero.
 */
export function computeBalances(expenses: readonly Expense[]): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (memberId: string, delta: number) => balances.set(memberId, (balances.get(memberId) ?? 0) + delta);

  for (const expense of expenses) {
    if (expense.beneficiaryIds.length === 0) {
      throw new Error("Expense " + expense.id + " has no beneficiaries.");
    }
    const shares = splitEvenly(expense.amountMinor, expense.beneficiaryIds.length);
    add(expense.payerId, expense.amountMinor);
    expense.beneficiaryIds.forEach((beneficiaryId, index) => add(beneficiaryId, -shares[index]));
  }

  for (const [memberId, balance] of balances) if (balance === 0) balances.delete(memberId);
  return balances;
}

/**
 * Greedy max-debtor / max-creditor matching. Each step fully settles at least one member, so this
 * emits at most n-1 transfers. That is not always the theoretical minimum (the exact problem is
 * NP-hard), but it is deterministic, runs instantly, and is easy for a group to verify by eye.
 */
export function simplifyDebts(expenses: readonly Expense[]): Transfer[] {
  const balances = computeBalances(expenses);

  const creditors = [...balances.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([memberId, balance]) => ({ memberId, balance }))
    .sort((left, right) => right.balance - left.balance || left.memberId.localeCompare(right.memberId));

  const debtors = [...balances.entries()]
    .filter(([, balance]) => balance < 0)
    .map(([memberId, balance]) => ({ memberId, balance: -balance }))
    .sort((left, right) => right.balance - left.balance || left.memberId.localeCompare(right.memberId));

  const transfers: Transfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountMinor = Math.min(creditor.balance, debtor.balance);

    if (amountMinor > 0) {
      transfers.push({ fromId: debtor.memberId, toId: creditor.memberId, amountMinor });
      creditor.balance -= amountMinor;
      debtor.balance -= amountMinor;
    }

    if (creditor.balance === 0) creditorIndex += 1;
    if (debtor.balance === 0) debtorIndex += 1;
  }

  return transfers;
}
