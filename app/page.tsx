import { TripSetupDashboard } from "@/components/trip-setup-dashboard";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login");
  return <TripSetupDashboard email={user.email ?? "Signed in"} />;
}
