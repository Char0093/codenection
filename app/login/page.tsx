import { LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { findMockAccount, mockAccountCookie, mockAccounts, mockAccountsEnabled } from "@/lib/mock/accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = isSupabaseConfigured();
  const showMockAccounts = mockAccountsEnabled();
  if (showMockAccounts && findMockAccount((await cookies()).get(mockAccountCookie)?.value)) redirect("/");
  if (configured) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (user) redirect("/");
  }
  return <LoginForm configured={configured} mockAccounts={showMockAccounts ? mockAccounts : []} />;
}
