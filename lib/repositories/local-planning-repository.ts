import type { PersistedPlanningState, PlanningRepository } from "@/lib/repositories/planning-repository";

const STORAGE_KEY = "waypoint.planning-state.v1";

export class LocalPlanningRepository implements PlanningRepository {
  load(fallback: PersistedPlanningState): PersistedPlanningState {
    if (typeof window === "undefined") return fallback;

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;

    try {
      return JSON.parse(stored) as PersistedPlanningState;
    } catch {
      return fallback;
    }
  }

  save(state: PersistedPlanningState): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
