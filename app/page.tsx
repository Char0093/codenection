import { TripSetupDashboard } from "@/components/trip-setup-dashboard";
import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cookies } from "next/headers";
import { findMockAccount, mockAccountCookie, mockAccounts, mockAccountsEnabled } from "@/lib/mock/accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (mockAccountsEnabled()) {
    const account = findMockAccount((await cookies()).get(mockAccountCookie)?.value);
    if (account) return <TripSetupDashboard email={`${account.email} (${account.role})`} />;
    return <LoginForm configured={false} mockAccounts={mockAccounts} />;
  }
  if (!isSupabaseConfigured()) return <LoginForm configured={false} />;
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return <LoginForm configured />;
  return <TripSetupDashboard email={user.email ?? "Signed in"} />;
}
