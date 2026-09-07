import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseTripRepository } from "@/lib/repositories/supabase-trip-repository";

const tripId = "12345678-1234-4123-8123-123456789012";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })) },
    rpc,
  } as unknown as SupabaseClient;
  return { db, rpc };
}

describe("listConfirmedConstraints via trip_enforced_constraints", () => {
  it("calls the union RPC and parses typed rows", async () => {
    const { db, rpc } = client({ data: [
      { kind: "dietary", flag: "no_peanut", severity: "severe" },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard" },
    ], error: null });
    const rows = await new SupabaseTripRepository(db).listConfirmedConstraints(tripId);
    expect(rpc).toHaveBeenCalledWith("trip_enforced_constraints", { p_trip_id: tripId });
    expect(rows).toEqual([
      { kind: "dietary", flag: "no_peanut", severity: "severe" },
      { kind: "religious_access", flag: "prayer_space_needed", severity: "standard" },
    ]);
  });

  it("maps an RPC error through databaseError", async () => {
    const { db } = client({ data: null, error: { code: "42501" } });
    await expect(new SupabaseTripRepository(db).listConfirmedConstraints(tripId))
      .rejects.toMatchObject({ status: 403 });
  });
});
