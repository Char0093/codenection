import { describe, expect, it } from "vitest";
import { type Expense, computeBalances, simplifyDebts, splitEvenly } from "@/lib/domain/debt-simplify";

describe("splitEvenly", () => {
  it("splits cleanly when it divides", () => {
    expect(splitEvenly(12000, 4)).toEqual([3000, 3000, 3000, 3000]);
  });

  it("gives remainder cents to the earliest beneficiaries so parts sum to the total", () => {
    const shares = splitEvenly(10000, 3);
    expect(shares).toEqual([3334, 3333, 3333]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10000);
  });

  it("keeps the sum exact for an awkward split", () => {
    const shares = splitEvenly(1, 4);
    expect(shares).toEqual([1, 0, 0, 0]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(1);
  });

  it("handles refunds without losing a cent", () => {
    const shares = splitEvenly(-10000, 3);
    expect(shares).toEqual([-3334, -3333, -3333]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(-10000);
  });

  it("rejects a non-integer amount and an empty beneficiary list", () => {
    expect(() => splitEvenly(10.5, 2)).toThrow(/integer minor units/);
    expect(() => splitEvenly(100, 0)).toThrow(/at least one beneficiary/);
  });
});

describe("computeBalances", () => {
  it("nets payers against beneficiaries and always sums to zero", () => {
    const expenses: Expense[] = [
      { id: "e1", payerId: "amira", amountMinor: 12000, beneficiaryIds: ["amira", "ben", "chloe", "danish"] },
      { id: "e2", payerId: "ben", amountMinor: 8000, beneficiaryIds: ["amira", "ben", "chloe", "danish"] },
    ];
    const balances = computeBalances(expenses);
    expect(balances.get("amira")).toBe(7000);
    expect(balances.get("ben")).toBe(3000);
    expect(balances.get("chloe")).toBe(-5000);
    expect(balances.get("danish")).toBe(-5000);
    expect([...balances.values()].reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it("drops members who come out exactly even", () => {
    const expenses: Expense[] = [
      { id: "e1", payerId: "amira", amountMinor: 1000, beneficiaryIds: ["amira"] },
    ];
    expect(computeBalances(expenses).has("amira")).toBe(false);
  });

  it("supports a subgroup-only cost", () => {
    const expenses: Expense[] = [
      { id: "e1", payerId: "chloe", amountMinor: 6000, beneficiaryIds: ["chloe", "amira"] },
    ];
    const balances = computeBalances(expenses);
    expect(balances.get("chloe")).toBe(3000);
    expect(balances.get("amira")).toBe(-3000);
    expect(balances.has("ben")).toBe(false);
  });

  it("rejects an expense with no beneficiaries", () => {
    expect(() => computeBalances([{ id: "bad", payerId: "amira", amountMinor: 100, beneficiaryIds: [] }])).toThrow(
      /no beneficiaries/,
    );
  });
});

describe("simplifyDebts", () => {
  it("collapses a tangle into at most n-1 transfers that settle everyone", () => {
    const expenses: Expense[] = [
      { id: "e1", payerId: "amira", amountMinor: 12000, beneficiaryIds: ["amira", "ben", "chloe", "danish"] },
      { id: "e2", payerId: "ben", amountMinor: 8000, beneficiaryIds: ["amira", "ben", "chloe", "danish"] },
      { id: "e3", payerId: "chloe", amountMinor: 4000, beneficiaryIds: ["amira", "ben", "chloe", "danish"] },
    ];

    const transfers = simplifyDebts(expenses);
    expect(transfers.length).toBeLessThanOrEqual(3);

    // Applying the transfers must zero every balance.
    const settled = computeBalances(expenses);
    for (const transfer of transfers) {
      settled.set(transfer.fromId, (settled.get(transfer.fromId) ?? 0) + transfer.amountMinor);
      settled.set(transfer.toId, (settled.get(transfer.toId) ?? 0) - transfer.amountMinor);
    }
    expect([...settled.values()].every((balance) => balance === 0)).toBe(true);
  });

  it("emits a single transfer for a simple two-person debt", () => {
    const transfers = simplifyDebts([
      { id: "e1", payerId: "amira", amountMinor: 5000, beneficiaryIds: ["amira", "ben"] },
    ]);
    expect(transfers).toEqual([{ fromId: "ben", toId: "amira", amountMinor: 2500 }]);
  });

  it("removes the middle leg of a circular debt", () => {
    // Amira paid for Ben, Ben paid for Chloe, Chloe paid for Amira, all equal.
    const expenses: Expense[] = [
      { id: "e1", payerId: "amira", amountMinor: 3000, beneficiaryIds: ["ben"] },
      { id: "e2", payerId: "ben", amountMinor: 3000, beneficiaryIds: ["chloe"] },
      { id: "e3", payerId: "chloe", amountMinor: 3000, beneficiaryIds: ["amira"] },
    ];
    // The cycle cancels entirely: nobody owes anybody.
    expect(simplifyDebts(expenses)).toEqual([]);
  });

  it("returns nothing when there is nothing to settle", () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it("is deterministic for equal balances", () => {
    const expenses: Expense[] = [
      { id: "e1", payerId: "amira", amountMinor: 9000, beneficiaryIds: ["amira", "ben", "chloe"] },
    ];
    expect(simplifyDebts(expenses)).toEqual(simplifyDebts(expenses));
  });
});
