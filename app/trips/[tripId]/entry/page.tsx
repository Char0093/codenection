import { notFound } from "next/navigation";
import { MemberEntryPanel } from "@/components/member-entry-panel";
import { getMyMemberEntryContext } from "@/app/actions/member-entry";

// Renders inside app/trips/[tripId]/layout.tsx (auth + membership gate + shell). Membership
// is re-checked inside getMyMemberEntryContext (403 -> notFound here).
export const dynamic = "force-dynamic";

export default async function TripEntryPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  let initial;
  try {
    initial = await getMyMemberEntryContext(tripId);
  } catch {
    notFound();
  }
  return <MemberEntryPanel tripId={tripId} initial={initial} />;
}
