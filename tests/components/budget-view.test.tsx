// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetView } from "@/features/prototype/budget-view";
import { computeBalances, simplifyDebts } from "@/lib/domain/debt-simplify";
import { DEMO_EXPENSES, MEMBER_IDS } from "@/lib/prototype/demo-features";

afterEach(cleanup);

describe("BudgetView", () => {
  it("balances net to zero and settle up to at most n-1 transfers", () => {
    const balances = computeBalances(DEMO_EXPENSES);
    expect([...balances.values()].reduce((s, v) => s + v, 0)).toBe(0);
    expect(simplifyDebts(DEMO_EXPENSES).length).toBeLessThanOrEqual(MEMBER_IDS.length - 1);
  });

  it("renders every expense and the engine's own transfer amounts", () => {
    render(<BudgetView />);
    for (const e of DEMO_EXPENSES) expect(screen.getByText(e.label)).toBeInTheDocument();
    for (const t of simplifyDebts(DEMO_EXPENSES)) {
      const rm = `RM ${Math.floor(t.amountMinor / 100)}.${String(t.amountMinor % 100).padStart(2, "0")}`;
      expect(screen.getAllByText(rm).length).toBeGreaterThan(0);
    }
  });

  it("marks the settle-up done and back again", async () => {
    const user = userEvent.setup();
    render(<BudgetView />);
    await user.click(screen.getByRole("button", { name: /mark all settled/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/resets on refresh/i);
    await user.click(screen.getByRole("button", { name: /mark unsettled/i }));
    expect(screen.queryByText(/resets on refresh/i)).not.toBeInTheDocument();
  });
});
