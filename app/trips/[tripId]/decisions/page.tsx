import { notFound } from "next/navigation";
import { DemoDecisions } from "@/features/prototype/demo-decisions";
import { isPrototype } from "@/lib/prototype/config";

// Feature: reviewable decision queue (chat signals + saved Timeline changes). Prototype-only,
// same shape as budget/page.tsx -- the real version has no backend yet.
export const dynamic = "force-dynamic";

export default async function TripDecisionsPage() {
  if (isPrototype()) return <DemoDecisions />;
  notFound();
}
