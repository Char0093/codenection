import { notFound, redirect } from "next/navigation";
import { WorkspaceClient } from "@/features/workspace/workspace-client";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import { tripRepository } from "@/lib/repositories/server";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  let trip;
  try {
    trip = await (await tripRepository()).getTrip(tripId);
  } catch {
    notFound();
  }

  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return (
    <WorkspaceClient
      tripId={trip.id}
      tripName={trip.destinationName}
      members={members}
      selfMemberId={selfMemberId}
      canDecideProposals={trip.role === "owner"}
      initialActiveProposalId={trip.activeProposalId}
      mapSlot={<TimelinePane tripId={trip.id} startDate={trip.startDate} endDate={trip.endDate} revision={trip.revision} />}
    />
  );
}
