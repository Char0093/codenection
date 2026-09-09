import { notFound } from "next/navigation";
import { SafetyView } from "@/features/prototype/safety-view";
import { isPrototype } from "@/lib/prototype/config";

// Feature: food-safety visual check. Prototype-only; the real version sends the photo to a
// vision model and runs the returned claims through lib/domain/constraint-gate.
export const dynamic = "force-dynamic";

export default async function TripSafetyPage() {
  if (isPrototype()) return <SafetyView />;
  notFound();
}
