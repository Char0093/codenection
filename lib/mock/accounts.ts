import type { TripRole } from "@/lib/domain/proposal";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type MockAccount = {
  id: string;
  email: string;
  label: string;
  role: TripRole;
};

export const mockAccountCookie = "waypoint_mock_account";

export const mockAccounts = [
  { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test", label: "Owner", role: "owner" },
  { id: "22222222-2222-4222-8222-222222222222", email: "planner@example.test", label: "Planner", role: "planner" },
  { id: "33333333-3333-4333-8333-333333333333", email: "member@example.test", label: "Member", role: "member" },
  { id: "44444444-4444-4444-8444-444444444444", email: "viewer@example.test", label: "Viewer", role: "viewer" },
] as const satisfies readonly MockAccount[];

export function mockAccountsEnabled(): boolean {
  return process.env.ENABLE_MOCK_ACCOUNTS === "true"
    || (process.env.NODE_ENV !== "production" && !isSupabaseConfigured());
}

export function findMockAccount(id: string | undefined): MockAccount | null {
  return mockAccounts.find((account) => account.id === id) ?? null;
}
