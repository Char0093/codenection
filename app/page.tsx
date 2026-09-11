import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isPrototype } from "@/lib/prototype/config";
import { WaypointLanding } from "@/features/marketing/waypoint-landing";

export const dynamic = "force-dynamic";

/**
 * The public marketing landing page for a signed-out visitor. Only a visitor Waypoint can
 * actually confirm is inside a session goes straight to their trips -- everyone else, including
 * every prototype/demo visit (that mode has no real session concept: the `wp_prototype` cookie
 * login-form.tsx sets is a persona marker only, never what gates access), sees the landing page.
 */
export default async function HomePage() {
  if (isPrototype()) return <WaypointLanding />;
  if (!isSupabaseConfigured()) return <WaypointLanding />;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return <WaypointLanding />;
  redirect("/chats");
}
