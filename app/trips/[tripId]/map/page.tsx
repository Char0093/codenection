import { notFound } from "next/navigation";
import { DemoMap } from "@/features/prototype/demo-map";
import { ClientOnly } from "@/features/prototype/client-only";
import { isPrototype } from "@/lib/prototype/config";

// Feature: live map + travel-time routing. Prototype-only for now -- the real version needs a
// routing provider (Google Routes) and per-leg travel-time blocks on the itinerary. Renders
// inside app/trips/[tripId]/layout.tsx (shell + gate). Client-only: the map screen is heavily
// interactive (drag sheet, live Directions) with no SSR value.
export const dynamic = "force-dynamic";

export default async function TripMapPage() {
  if (isPrototype()) return <ClientOnly><DemoMap /></ClientOnly>;
  // No non-prototype implementation yet: the sidebar only links here in prototype mode.
  notFound();
}
