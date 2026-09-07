import { redirect } from "next/navigation";
import { UserOnboardingWizard } from "@/components/user-onboarding-wizard";
import { getMyUserOnboarding } from "@/app/actions/user-onboarding";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/supabase/redirect";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login");

  const snapshot = await getMyUserOnboarding();
  const { next } = await searchParams;
  // Interim default "/"; Slice 3 makes the default "/chats".
  const successHref = safeRedirectPath(next ?? null);

  return (
    <main className="app-shell onboarding-shell">
      <UserOnboardingWizard initial={snapshot} successHref={successHref} />
    </main>
  );
}
