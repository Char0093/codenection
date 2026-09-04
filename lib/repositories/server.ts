import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { findMockAccount, mockAccountCookie, mockAccountsEnabled } from "@/lib/mock/accounts";
import { MockTripRepository } from "@/lib/mock/repository";
import { SupabaseTripRepository } from "./supabase-trip-repository";

export async function tripRepository() {
  if (mockAccountsEnabled()) {
    const account = findMockAccount((await cookies()).get(mockAccountCookie)?.value);
    if (account) return new MockTripRepository(account);
  }
  return new SupabaseTripRepository(await createClient());
}
