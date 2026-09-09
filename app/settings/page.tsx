import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import { PreferenceSurvey } from "@/components/preference-survey";
import { getMyUserOnboarding } from "@/app/actions/user-onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isPrototype } from "@/lib/prototype/config";
import { DEMO_USER } from "@/lib/prototype/fixtures";
import { createClient } from "@/lib/supabase/server";

// Global account settings: edits the same Travel DNA profile captured during first-login
// onboarding (dietary/access needs + exploration dial). Deliberately not the per-trip
// member-entry details captured after joining a specific group -- those stay their own thing
// at /trips/[tripId]/entry ("Your prefs" in the sidebar). Replaces /preferences, which now
// redirects here.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (isPrototype()) {
    return (
      <AppShell accountEmail={DEMO_USER.email}>
        <div className="onboarding-shell">
          <PreferenceSurvey />
        </div>
        <div className="settings-signout">
          <h2>Travel DNA (safety)</h2>
          <p className="field-hint">
            In the demo the safety-vault editor is read-only. In the full app this is where
            dietary, religious-access and mobility requirements are edited — the only changes
            that force an itinerary review.
          </p>
        </div>
      </AppShell>
    );
  }
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const snapshot = await getMyUserOnboarding();

  return (
    <AppShell accountEmail={user.email}>
      <div className="onboarding-shell">
        <UserOnboardingWizard initial={snapshot} successHref="/settings"
          title="Your Travel Preferences"
          subtitle="Update the needs you always want respected, and how adventurous suggestions should be. Saved dietary, religious-access, and mobility requirements are add-only here for now." />
      </div>
      <div className="settings-signout">
        <h2>Account</h2>
        <p className="field-hint">Signed in as {user.email}.</p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="secondary-button"><LogOut aria-hidden="true" />Log out</button>
        </form>
      </div>
    </AppShell>
  );
}
