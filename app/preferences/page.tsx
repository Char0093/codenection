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
    <main className="app-shell">
      <div className="section-heading">
        <div>
          <h1>Your Travel Preferences</h1>
          <p className="field-hint">
            Update the needs you always want respected, and how adventurous suggestions should be.
            Saved dietary, religious-access, and mobility requirements are add-only here for now.
          </p>
        </div>
      </div>
      <UserOnboardingWizard initial={snapshot} successHref="/preferences" />
    </main>
  );
}
