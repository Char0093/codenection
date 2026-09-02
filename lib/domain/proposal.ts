export type ProposalStatus = "pending" | "accepted" | "rejected";
export type TripRole = "owner" | "planner" | "member" | "viewer";

export function confirmProposal(status: ProposalStatus, role: TripRole): ProposalStatus {
  if (status !== "pending") {
    throw new Error("Only pending proposals can be confirmed.");
  }

  if (role !== "owner" && role !== "planner") {
    throw new Error("Only a trip owner or planner can activate this proposal.");
  }

  return "accepted";
}
