import "server-only";
import { createClient } from "@/lib/supabase/server";
import { SupabaseTripRepository } from "./supabase-trip-repository";

export async function tripRepository() {
  return new SupabaseTripRepository(await createClient());
}
