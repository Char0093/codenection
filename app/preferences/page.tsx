import { redirect } from "next/navigation";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import { getMyUserOnboarding } from "@/app/actions/user-onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const snapshot = await getMyUserOnboarding();

  return (
    <main className="app-shell onboarding-shell">
      <UserOnboardingWizard initial={snapshot} successHref="/preferences"
        title="Your Travel Preferences"
        subtitle="Update the needs you always want respected, and how adventurous suggestions should be. Saved dietary, religious-access, and mobility requirements are add-only here for now." />
    </main>
  );
}
