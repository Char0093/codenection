import { LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = isSupabaseConfigured();
  if (configured) {
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (user) redirect("/");
  }
  return <LoginForm configured={configured} />;
}
