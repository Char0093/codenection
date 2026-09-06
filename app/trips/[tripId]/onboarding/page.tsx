import { notFound, redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { getMyOnboarding } from "@/app/actions/onboarding";
import { tripRepository } from "@/lib/repositories/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ params }: { params: Promise<{ tripId: string }> }) {
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

  const snapshot = await getMyOnboarding(trip.id);

  return (
    <main className="app-shell">
      <div className="section-heading"><h1>Travel DNA — {trip.destinationName}</h1></div>
      <OnboardingWizard tripId={trip.id} initial={snapshot} successHref={`/trips/${trip.id}/workspace`} />
    </main>
  );
}
