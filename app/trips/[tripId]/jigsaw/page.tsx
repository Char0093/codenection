import { notFound } from "next/navigation";
import { JigsawView } from "@/features/prototype/jigsaw-view";
import { isPrototype } from "@/lib/prototype/config";

// Feature: jigsaw conflict resolution. Prototype-only -- the real version needs survey-derived
// member weights feeding lib/domain/jigsaw. Renders inside app/trips/[tripId]/layout.tsx.
export const dynamic = "force-dynamic";

export default async function TripJigsawPage() {
  if (isPrototype()) return <JigsawView />;
  notFound();
}
