import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { MemberEntryPanel } from "@/components/member-entry-panel";
import { getMyMemberEntryContext } from "@/app/actions/member-entry";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// Per-trip member entry (spec §2.4). Membership is enforced inside getMyMemberEntryContext
// (403 -> notFound here). Slice 5 folds this into the shared selected-trip shell.
export const dynamic = "force-dynamic";

export default async function TripEntryPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;
  if (!z.string().uuid().safeParse(tripId).success) notFound();

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  let initial;
  try {
    initial = await getMyMemberEntryContext(tripId);
  } catch {
    notFound();
  }

  return (
    <main className="app-shell">
      <div className="section-heading">
        <div><h1>Your trip preferences</h1></div>
        <Link className="secondary-button" href={`/trips/${tripId}/chat`}>Back to chat</Link>
      </div>
      <MemberEntryPanel tripId={tripId} initial={initial} />
    </main>
  );
}
