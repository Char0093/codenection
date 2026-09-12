import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isPrototype } from "@/lib/prototype/config";
import { DEMO_TRIP, DEMO_USER } from "@/lib/prototype/fixtures";
import { DemoTripStateProvider } from "@/features/prototype/demo-trip-state";
import { createClient } from "@/lib/supabase/server";

// The single auth + membership gate for every /trips/[tripId]/* page. Draft-tolerant: it
// reads `trips.name` / `trips.status` directly rather than going through getTrip (which
// rejects a draft trip's null dates). Child pages keep only their own data fetches.
export const dynamic = "force-dynamic";

export default async function TripLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  if (isPrototype()) {
    return (
      <AppShell trip={{ id: DEMO_TRIP.id, name: DEMO_TRIP.name, ready: DEMO_TRIP.status === "ready" }} accountEmail={DEMO_USER.email}>
        <DemoTripStateProvider>
          <div className="workspace-main">{children}</div>
        </DemoTripStateProvider>
      </AppShell>
    );
  }

  if (!isSupabaseConfigured()) redirect("/login");
  if (!z.string().uuid().safeParse(tripId).success) notFound();

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership }, { data: trip }] = await Promise.all([
    client.from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle(),
    client.from("trips").select("name,status").eq("id", tripId).maybeSingle(),
  ]);
  if (!membership || !trip) notFound();

  const row = trip as { name: string; status: string };
  return (
    <AppShell trip={{ id: tripId, name: row.name, ready: row.status === "ready" }} accountEmail={user.email}>
      <div className="workspace-main">{children}</div>
    </AppShell>
  );
}
