import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseTripRepository } from "@/lib/repositories/supabase-trip-repository";

const input = { destinationName: "Penang", startDate: "2026-10-03", endDate: "2026-10-04", budgetTier: "standard", pace: "balanced" } as const;
const trip = { id: "12345678-1234-4123-8123-123456789012", owner_user_id: "owner", destination_name: "Penang", start_date: input.startDate, end_date: input.endDate, budget_tier: "standard", pace: "balanced", notes: null, revision: 1, active_proposal_id: null };

function client(options: { user?: string | null; visible?: boolean; role?: string; updateError?: boolean } = {}) {
  const rows: Record<string, unknown[]> = { trips: options.visible === false ? [] : [trip], trip_members: [{ role: options.role ?? "owner" }] };
  let inserted: unknown;
  let updated: unknown;
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: options.user === null ? null : { id: options.user ?? "owner" } }, error: null })) },
    from: (table: string) => {
      let operation = "select";
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        insert: (value: unknown) => { inserted = value; operation = "insert"; return query; },
        update: (value: unknown) => { updated = value; operation = "update"; return query; },
        single: async () => ({ data: rows[table]?.[0] ?? null, error: options.updateError && operation === "update" ? { code: "42501" } : null }),
        maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
        then: (resolve: (result: unknown) => void) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, inserted: () => inserted, updated: () => updated };
}

describe("authenticated trip repository", () => {
  it("creates with verified user ownership and only allowed trip inputs", async () => {
    const fake = client();
    const result = await new SupabaseTripRepository(fake.db).createTrip(input);
    expect(result.destinationName).toBe("Penang");
    expect(result.role).toBe("owner");
    expect(fake.inserted()).toMatchObject({ owner_user_id: "owner", destination_name: "Penang" });
    expect(fake.inserted()).not.toHaveProperty("members");
  });
  it("refuses anonymous creation", async () => {
    const fake = client({ user: null });
    await expect(new SupabaseTripRepository(fake.db).createTrip(input)).rejects.toMatchObject({ status: 401 });
    expect(fake.inserted()).toBeUndefined();
  });
  it("loads persisted trips and maps membership role", async () => {
    const fake = client({ role: "member" });
    expect(await new SupabaseTripRepository(fake.db).getTrip(trip.id)).toMatchObject({ id: trip.id, role: "member", revision: 1 });
  });
  it("denies unrelated-user reads and updates when RLS hides the trip", async () => {
    const fake = client({ user: "outsider", visible: false });
    const repository = new SupabaseTripRepository(fake.db);
    await expect(repository.getTrip(trip.id)).rejects.toMatchObject({ status: 404 });
    await expect(repository.updateTrip(trip.id, input)).rejects.toMatchObject({ status: 404 });
    expect(fake.updated()).toBeUndefined();
  });
  it("permits planners to update only input columns", async () => {
    const fake = client({ user: "planner", role: "planner" });
    await new SupabaseTripRepository(fake.db).updateTrip(trip.id, input);
    expect(fake.updated()).toMatchObject({ destination_name: "Penang" });
    expect(fake.updated()).not.toHaveProperty("owner_user_id");
  });
  it("denies ordinary-member writes before contacting the update endpoint", async () => {
    const fake = client({ role: "member" });
    await expect(new SupabaseTripRepository(fake.db).updateTrip(trip.id, input)).rejects.toMatchObject({ status: 403 });
    expect(fake.updated()).toBeUndefined();
  });
  it("maps database permission errors without exposing raw details", async () => {
    const fake = client({ updateError: true });
    await expect(new SupabaseTripRepository(fake.db).updateTrip(trip.id, input)).rejects.toMatchObject({ status: 403 });
  });
  it("rejects forged extra input fields", async () => {
    const fake = client();
    await expect(new SupabaseTripRepository(fake.db).createTrip({ ...input, owner_user_id: "attacker" } as typeof input)).rejects.toThrow();
    expect(fake.inserted()).toBeUndefined();
  });
});
