import type { MemberPlanningProfile } from "@/lib/domain/itinerary";
import type { TripSetupInput } from "@/lib/domain/trip";

export type PersistedPlanningState = {
  trip: TripSetupInput;
  members: MemberPlanningProfile[];
  proposalStatus: "idle" | "pending" | "accepted";
};

export interface PlanningRepository {
  load(fallback: PersistedPlanningState): PersistedPlanningState;
  save(state: PersistedPlanningState): void;
}
