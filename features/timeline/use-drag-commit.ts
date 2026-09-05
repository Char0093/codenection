"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listActiveItineraryItems, type ActiveItineraryItem } from "@/lib/itinerary/repository";

class ReorderRejected extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "ReorderRejected";
  }
}

async function requestReorder(tripId: string, itemId: string, expectedRevision: number, newDate: string, newStartTime: string) {
  const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/itinerary/reorder`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, expectedRevision, newDate, newStartTime }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ReorderRejected(data?.error || "That move was refused.", data?.code || "REQUEST_FAILED", response.status);
  return data as { item: ActiveItineraryItem; revision: number };
}

export type DragItem = ActiveItineraryItem & { pending?: boolean; rejectedReason?: string };

/**
 * Task 3.4: optimistic drag, server-validated write, and remote sync. A drop applies locally at
 * once; the server call either confirms it, refuses it with a shown reason, or -- on a stale
 * revision -- triggers a refetch rather than guessing who moved first. Another member's accepted
 * drag bumps trips.revision, which this hook watches to pull in remote changes live.
 */
export function useDragCommit(tripId: string, initialRevision = 1) {
  const [items, setItems] = useState<DragItem[]>([]);
  const [revision, setRevision] = useState(initialRevision);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const client = useRef(createClient());
  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  const refetch = useCallback(async () => {
    const [fresh, tripRow] = await Promise.all([
      listActiveItineraryItems(client.current, tripId),
      client.current.from("trips").select("revision").eq("id", tripId).single(),
    ]);
    setItems(fresh);
    const nextRevision = (tripRow.data as { revision?: number } | null)?.revision;
    if (!tripRow.error && typeof nextRevision === "number") setRevision(nextRevision);
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    refetch()
      .catch((cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Unable to load the itinerary.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, refetch]);

  useEffect(() => {
    const channel = client.current
      .channel("trip:" + tripId + ":itinerary")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips", filter: "id=eq." + tripId },
        (payload) => {
          const nextRevision = (payload.new as { revision?: number } | undefined)?.revision;
          if (typeof nextRevision === "number" && nextRevision !== revisionRef.current) void refetch();
        },
      )
      .subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }, [tripId, refetch]);

  const commitDrag = useCallback(
    async (itemId: string, newDate: string, newStartTime: string) => {
      const before = items;
      setItems((existing) =>
        existing.map((item) =>
          item.id === itemId ? { ...item, localDate: newDate, localStartTime: newStartTime, pending: true, rejectedReason: undefined } : item,
        ),
      );
      try {
        const result = await requestReorder(tripId, itemId, revisionRef.current, newDate, newStartTime);
        setRevision(result.revision);
        setItems((existing) => existing.map((entry) => (entry.id === itemId ? { ...result.item, pending: false } : entry)));
      } catch (cause) {
        if (cause instanceof ReorderRejected && cause.code === "CONFLICT") {
          // Someone else moved first. Refetch rather than guess who is right.
          await refetch();
        } else {
          const reason = cause instanceof Error ? cause.message : "That move was refused.";
          setItems(before.map((item) => (item.id === itemId ? { ...item, pending: false, rejectedReason: reason } : item)));
        }
      }
    },
    [items, tripId, refetch],
  );

  return { items, revision, loading, loadError, commitDrag };
}
