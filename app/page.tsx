import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isPrototype } from "@/lib/prototype/config";

// Authenticated root goes to the chat-group home (spec §5). Incomplete Travel DNA is caught
// upstream by the middleware gate before this runs.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (isPrototype()) redirect("/chats");
  if (!isSupabaseConfigured()) redirect("/login");
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login");
  redirect("/chats");
}
