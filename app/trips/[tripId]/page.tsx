import { redirect } from "next/navigation";

// Chat is the default selected-trip surface (spec §2.3).
export const dynamic = "force-dynamic";

export default async function TripIndexPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/chat`);
}
