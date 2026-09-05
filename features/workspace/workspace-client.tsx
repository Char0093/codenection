"use client";

import React, { useEffect, useState } from "react";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";
import { ChatPane } from "@/features/chat/chat-pane";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";
import type { ProposalRecord } from "@/lib/repositories/planning-repository";

export function WorkspaceClient({ tripId, tripName, members, selfMemberId, canDecideProposals, initialActiveProposalId, mapSlot }: {
  tripId: string;
  tripName: string;
  members: readonly JigsawMember[];
  selfMemberId: string | null;
  canDecideProposals: boolean;
  initialActiveProposalId: string | null;
  mapSlot: React.ReactNode;
}) {
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(initialActiveProposalId);
  const [decidingProposalId, setDecidingProposalId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trips/${encodeURIComponent(tripId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setProposals(data?.proposals ?? []);
        if (data?.trip?.activeProposalId) setActiveProposalId(data.trip.activeProposalId);
      })
      .catch(() => {
        // The chat still works without proposal cards resolving; not fatal.
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const proposalsById = Object.fromEntries(proposals.map((proposal) => [proposal.id, proposal]));

  async function handleDecision(proposalId: string, decision: "accept" | "reject") {
    setDecidingProposalId(proposalId);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/proposals/${encodeURIComponent(proposalId)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.proposal) {
        setProposals((existing) => existing.map((proposal) => (proposal.id === data.proposal.id ? data.proposal : proposal)));
        if (data.proposal.status === "accepted") setActiveProposalId(data.proposal.id);
      }
    } finally {
      setDecidingProposalId(null);
    }
  }

  return <WorkspaceShell tripName={tripName} members={members} blocks={[]}
    mapSlot={mapSlot}
    chatSlot={<ChatPane tripId={tripId} selfMemberId={selfMemberId} members={members}
      proposalsById={proposalsById} canDecideProposals={canDecideProposals}
      activeProposalId={activeProposalId} decidingProposalId={decidingProposalId} onDecision={handleDecision} />} />;
}
