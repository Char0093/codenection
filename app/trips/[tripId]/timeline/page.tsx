import { notFound, redirect } from "next/navigation";
import { TimelinePane } from "@/features/timeline/timeline-pane";
import { DemoTimeline } from "@/features/prototype/demo-timeline";
import { isPrototype } from "@/lib/prototype/config";
import { tripRepository } from "@/lib/repositories/server";
import { createClient } from "@/lib/supabase/server";

// The pre-generation timeline. Only a `ready` trip has the date range TimelinePane needs;
// a draft shows the locked state. Auth + membership are gated by the layout.
export const dynamic = "force-dynamic";

export default async function TripTimelinePage({ params }: { params: Promise<{ tripId: string }> }) {
  if (isPrototype()) return <DemoTimeline />;

  const { tripId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await client.from("trips").select("status").eq("id", tripId).maybeSingle();
  if (!trip) notFound();
  if ((trip as { status: string }).status !== "ready") {
    return (
      <div className="empty-state">
        <h2>Timeline is locked</h2>
        <p>Add a destination and trip dates to open the timeline.</p>
      </div>
    );
  }

  const record = await (await tripRepository()).getTrip(tripId);
  return <TimelinePane tripId={record.id} startDate={record.startDate} endDate={record.endDate} revision={record.revision} />;
}
