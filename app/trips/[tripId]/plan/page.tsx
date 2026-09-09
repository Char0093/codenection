import { notFound, redirect } from "next/navigation";
import { PlanView } from "@/features/planning/plan-view";
import { DemoPlan } from "@/features/prototype/demo-plan";
import { ClientOnly } from "@/features/prototype/client-only";
import { isPrototype } from "@/lib/prototype/config";
import { tripRepository } from "@/lib/repositories/server";
import { createClient } from "@/lib/supabase/server";

// The written itinerary (see PlanView). Only a `ready` trip (valid destination + date range)
// reaches getTrip; a draft shows the locked state. Auth + membership are gated by the layout.
export const dynamic = "force-dynamic";

export default async function TripPlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (isPrototype()) return <ClientOnly><DemoPlan /></ClientOnly>;

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
  return <PlanView tripId={record.id} canDecideProposals={record.role === "owner"} />;
}
