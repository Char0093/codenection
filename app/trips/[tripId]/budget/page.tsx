import { notFound } from "next/navigation";
import { BudgetView } from "@/features/prototype/budget-view";
import { isPrototype } from "@/lib/prototype/config";

// Feature: budget ledger. Prototype-only; the real version persists expenses per trip and runs
// the same lib/domain/debt-simplify pass server-side.
export const dynamic = "force-dynamic";

export default async function TripBudgetPage() {
  if (isPrototype()) return <BudgetView />;
  notFound();
}
