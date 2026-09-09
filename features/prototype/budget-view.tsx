"use client";

import React, { useMemo, useState } from "react";
import { ArrowRight, Receipt, Scale, Wallet } from "lucide-react";
import { computeBalances, simplifyDebts } from "@/lib/domain/debt-simplify";
import {
  CURRENCY, DEMO_EXPENSES, MEMBER_IDS, memberColor, memberName,
} from "@/lib/prototype/demo-features";

/** Integer sen -> "RM 45.00". No floating point touches the arithmetic, only the display. */
function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${CURRENCY} ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Feature: budget ledger. The balances and settle-up transfers are computed by
 * `lib/domain/debt-simplify` (integer minor units, greedy max-debtor matching) rather than being
 * written into the fixture — so the split shown is the one the real app would produce.
 */
export function BudgetView() {
  const [settled, setSettled] = useState(false);

  const balances = useMemo(() => computeBalances(DEMO_EXPENSES), []);
  const transfers = useMemo(() => simplifyDebts(DEMO_EXPENSES), []);
  const total = useMemo(() => DEMO_EXPENSES.reduce((s, e) => s + e.amountMinor, 0), []);
  const paidBy = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of DEMO_EXPENSES) map.set(e.payerId, (map.get(e.payerId) ?? 0) + e.amountMinor);
    return map;
  }, []);

  return (
    <section className="budget-view">
      <div className="section-heading">
        <div>
          <h1>Trip ledger</h1>
          <p className="field-hint">{DEMO_EXPENSES.length} expenses · {money(total)} total · {MEMBER_IDS.length} people</p>
        </div>
      </div>
      <p className="demo-hint">Demo — the expenses are sample data; the balances and settle-up below are computed by the real ledger engine.</p>

      {/* Per-person position */}
      <div className="bud-balances">
        {MEMBER_IDS.map((id) => {
          const net = balances.get(id) ?? 0;
          return (
            <div key={id} className="bud-balance" data-state={net > 0 ? "up" : net < 0 ? "down" : "even"}>
              <span className="jig-avatar" style={{ background: memberColor(id) }}>{memberName(id).slice(0, 1)}</span>
              <span className="bud-balance-name">{memberName(id)}</span>
              <span className="bud-balance-paid">paid {money(paidBy.get(id) ?? 0)}</span>
              <strong className="bud-balance-net">
                {net > 0 ? `is owed ${money(net)}` : net < 0 ? `owes ${money(-net)}` : "settled"}
              </strong>
            </div>
          );
        })}
      </div>

      {/* Settle up */}
      <div className="bud-settle">
        <div className="jig-card-head">
          <Scale size={15} aria-hidden="true" />
          <h2>Settle up</h2>
        </div>
        <p className="field-hint">
          Simplified to {transfers.length} transfer{transfers.length === 1 ? "" : "s"} instead of everyone
          paying everyone.
        </p>
        <ul className="bud-transfers">
          {transfers.map((t, i) => (
            <li key={i} className="bud-transfer" data-done={settled ? "true" : undefined}>
              <span className="jig-avatar" style={{ background: memberColor(t.fromId) }}>{memberName(t.fromId).slice(0, 1)}</span>
              <span className="bud-transfer-name">{memberName(t.fromId)}</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span className="jig-avatar" style={{ background: memberColor(t.toId) }}>{memberName(t.toId).slice(0, 1)}</span>
              <span className="bud-transfer-name">{memberName(t.toId)}</span>
              <strong className="bud-transfer-amount">{money(t.amountMinor)}</strong>
            </li>
          ))}
        </ul>
        <div className="onboarding-nav">
          <span />
          <button type="button" className="primary-button" onClick={() => setSettled((v) => !v)}>
            <Wallet aria-hidden="true" />{settled ? "Mark unsettled" : "Mark all settled"}
          </button>
        </div>
        {settled && <p className="inline-notice" role="status"><span>Marked settled for this session — resets on refresh.</span></p>}
      </div>

      {/* Expenses */}
      <div className="bud-list">
        <div className="jig-card-head">
          <Receipt size={15} aria-hidden="true" />
          <h2>Expenses</h2>
        </div>
        <ul>
          {DEMO_EXPENSES.map((e) => (
            <li key={e.id} className="bud-expense">
              <div className="bud-expense-main">
                <strong>{e.label}</strong>
                <span className="field-hint">
                  {e.category} · {e.paidOn} · paid by {memberName(e.payerId)}
                  {e.beneficiaryIds.length < MEMBER_IDS.length && ` · split ${e.beneficiaryIds.length} ways`}
                </span>
              </div>
              <span className="bud-expense-amount">{money(e.amountMinor)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
