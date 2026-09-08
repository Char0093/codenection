import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getChatHome } from "@/lib/repositories/chat-home";
import { ChatHomeView } from "@/components/chat-home-view";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const home = await getChatHome(client);
  return (
    <AppShell accountEmail={user.email}>
      <ChatHomeView trips={home.trips} />
    </AppShell>
  );
}
