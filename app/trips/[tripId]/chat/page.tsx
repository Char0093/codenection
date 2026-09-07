import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { ChatPane } from "@/features/chat/chat-pane";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// Minimal selected-trip chat surface. Membership is checked directly (not via getTrip, which
// rejects a draft trip's null dates). Slice 5 wraps this in the shared Chat/Plan/Timeline
// shell and redirects the legacy /workspace route here.
export const dynamic = "force-dynamic";

export default async function TripChatPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { tripId } = await params;
  if (!z.string().uuid().safeParse(tripId).success) notFound();

  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await client
    .from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();

  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return (
    <main className="app-shell">
      <div className="section-heading">
        <div><h1>Trip chat</h1></div>
        <div className="section-heading-actions">
          <Link className="secondary-button" href={`/trips/${tripId}/entry`}>Your trip preferences</Link>
          <Link className="secondary-button" href="/chats">All trip groups</Link>
        </div>
      </div>
      <ChatPane tripId={tripId} selfMemberId={selfMemberId} members={members} />
    </main>
  );
}
