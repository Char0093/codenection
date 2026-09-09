import { redirect } from "next/navigation";
import { ChatPane } from "@/features/chat/chat-pane";
import { DemoChat } from "@/features/prototype/demo-chat";
import { ClientOnly } from "@/features/prototype/client-only";
import { isPrototype } from "@/lib/prototype/config";
import { colorForMemberIndex, listTripMembers } from "@/lib/repositories/members";
import { createClient } from "@/lib/supabase/server";

// Renders inside app/trips/[tripId]/layout.tsx, which owns the auth + membership gate and the
// shared shell chrome. This page only supplies the chat pane's data.
export const dynamic = "force-dynamic";

export default async function TripChatPage({ params }: { params: Promise<{ tripId: string }> }) {
  if (isPrototype()) return <ClientOnly><DemoChat /></ClientOnly>;

  const { tripId } = await params;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const memberRows = await listTripMembers(client, tripId);
  const members = memberRows.map((row, index) => ({ id: row.id, displayName: row.displayName, color: colorForMemberIndex(index) }));
  const selfMemberId = memberRows.find((row) => row.userId === user.id)?.id ?? null;

  return <ChatPane tripId={tripId} selfMemberId={selfMemberId} members={members} />;
}
