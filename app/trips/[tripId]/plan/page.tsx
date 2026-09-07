import { notFound, redirect } from "next/navigation";
import { WorkspaceClient } from "@/features/workspace/workspace-client";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import { tripRepository } from "@/lib/repositories/server";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { createClient } from "@/lib/supabase/server";

// The map + chat planning workspace. Only a `ready` trip (valid destination + date range)
// reaches getTrip; a draft shows the locked state. Auth + membership are gated by the layout.
export const dynamic = "force-dynamic";

export default async function TripPlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await client.from("trips").select("status").eq("id", tripId).maybeSingle();
  if (!trip) notFound();
  if ((trip as { status: string }).status !== "ready") {
    return (
      <div className="empty-state">
        <h2>Planning is locked</h2>
        <p>Add a destination and a start and end date to this trip to start planning.</p>
      </div>
    );
  }

  const record = await (await tripRepository()).getTrip(tripId);
  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return (
    <WorkspaceClient
      tripId={record.id}
      members={members}
      selfMemberId={selfMemberId}
      canDecideProposals={record.role === "owner"}
      initialActiveProposalId={record.activeProposalId}
      mapSlot={<TimelinePane tripId={record.id} startDate={record.startDate} endDate={record.endDate} revision={record.revision} />}
      needsOnboarding={false}
    />
  );
}
