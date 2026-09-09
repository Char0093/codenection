import { notFound } from "next/navigation";
import { PackingView } from "@/features/prototype/packing-view";
import { isPrototype } from "@/lib/prototype/config";

// Feature: packing checklist. Prototype-only; the real version derives items from the live
// forecast, the itinerary's venue dress codes, and confirmed constraints.
export const dynamic = "force-dynamic";

export default async function TripPackingPage() {
  if (isPrototype()) return <PackingView />;
  notFound();
}
