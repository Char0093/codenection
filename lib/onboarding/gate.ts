/** Paths the first-login onboarding gate must never redirect. `/login` + `/auth/*` are
 *  already handled as `publicRoute` in middleware; this covers the rest so the gate can
 *  neither loop nor block the flow that completes onboarding. */
export function isGateExempt(path: string): boolean {
  return path.startsWith("/api/")
    || path === "/onboarding"
    || path.startsWith("/onboarding/");
}

// Loose on purpose: middleware passes its `@supabase/ssr` server client, a server component
// passes `createClient()`'s. Both expose `.from(t).select(c).maybeSingle()` returning a
// thenable `{ data, error }`; RLS scopes the read to `auth.uid()`.
type ProbeResult = { data: { onboarding_completed_at?: string | null } | null; error: unknown };
type OnboardingProbeClient = {
  from: (table: string) => {
    select: (columns: string) => { maybeSingle: () => PromiseLike<ProbeResult> };
  };
};

/** True when the caller has a completed global Travel DNA profile. Self-only RLS makes this
 *  a single-row PK lookup. A missing row or null timestamp means "not done". A DB error
 *  fails OPEN (returns true): a transient blip must not strand a completed user at
 *  `/onboarding`, and `submit_user_onboarding` still CAS-checks on the way in. */
export async function isOnboardingComplete(client: OnboardingProbeClient): Promise<boolean> {
  const { data, error } = await client
    .from("user_travel_profiles")
    .select("onboarding_completed_at")
    .maybeSingle();
  if (error) return true;
  return data?.onboarding_completed_at != null;
}
