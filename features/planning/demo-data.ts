import type { ActivityCandidate } from "@/lib/domain/itinerary";
import type { TripInput } from "@/lib/domain/trip";

// Ordinary sample content for explicit demos and tests, never runtime defaults.
export const demoTrip: TripInput = {
  destinationName: "George Town, Penang",
  startDate: "2026-10-03",
  endDate: "2026-10-05",
  budgetTier: "standard",
  pace: "balanced",
  notes: "Museums, food markets, and short transfers.",
};

export const demoCandidates: ActivityCandidate[] = [
  {
    id: "museum", title: "Museum visit", category: "culture", date: "2026-10-03",
    costTier: "standard", startTime: "10:00", durationMinutes: 90,
    rationale: "Start with a short cultural visit.", contingencyNote: "Verify opening hours before visiting.",
  },
  {
    id: "market", title: "Food market lunch", category: "food", date: "2026-10-04",
    costTier: "budget", startTime: "12:00", durationMinutes: 60,
    rationale: "Explore local food stalls.", contingencyNote: "Prices and stall availability need verification.",
  },
  {
    id: "gallery", title: "Gallery visit", category: "culture", date: "2026-10-05",
    costTier: "standard", startTime: "10:00", durationMinutes: 75,
    rationale: "A final morning cultural stop.", contingencyNote: null,
  },
];
