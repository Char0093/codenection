"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listActiveItineraryItems, type ActiveItineraryItem } from "@/lib/itinerary/repository";
import { minutesToTime, timeToMinutes } from "@/features/timeline/calendar-geometry";

class ReorderRejected extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "ReorderRejected";
  }
}

async function requestJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ReorderRejected(data?.error || "That change was refused.", data?.code || "REQUEST_FAILED", response.status);
  return data as T;
}

export type DragItem = ActiveItineraryItem & {
  pending?: boolean;
  rejectedReason?: string;
  /** Derived at render time from the pool candidate's opening status, so the warning survives a
   * reload without hardening an unknown into a stored claim. */
  hoursUnverified?: boolean;
};
type EditResult = { item: ActiveItineraryItem; revision: number };

/**
 * Task 3.4: optimistic edit, server-validated write, and remote sync -- shared by move, resize,
 * and unlock, all of which mutate the same underlying itinerary state. A change applies locally at
 * once; the server call either confirms it, refuses it with a shown reason, or -- on a stale
 * revision -- triggers a refetch rather than guessing who moved first. Another member's accepted
 * edit bumps trips.revision, which this hook watches to pull in remote changes live.
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

  /** Shared apply/rollback shape for every mutating action against this itinerary. `optimistic`
   * previews the change locally before the network call; `request` performs it server-side. */
  const commit = useCallback(
    async (itemId: string, optimistic: (item: DragItem) => DragItem, request: () => Promise<EditResult>) => {
      const before = items;
      setItems((existing) => existing.map((item) => (item.id === itemId ? { ...optimistic(item), pending: true, rejectedReason: undefined } : item)));
      try {
        const result = await request();
        setRevision(result.revision);
        setItems((existing) => existing.map((entry) => (entry.id === itemId ? { ...result.item, pending: false } : entry)));
      } catch (cause) {
        if (cause instanceof ReorderRejected && cause.code === "CONFLICT") {
          // Someone else moved first. Refetch rather than guess who is right.
          await refetch();
        } else {
          const reason = cause instanceof Error ? cause.message : "That change was refused.";
          setItems(before.map((item) => (item.id === itemId ? { ...item, pending: false, rejectedReason: reason } : item)));
        }
      }
    },
    [items, refetch],
  );

  const commitDrag = useCallback(
    (itemId: string, newDate: string, newStartTime: string) =>
      commit(
        itemId,
        (item) => {
          const durationMinutes = timeToMinutes(item.localEndTime) - timeToMinutes(item.localStartTime);
          const newStartMinutes = timeToMinutes(newStartTime);
          return {
            ...item, localDate: newDate,
            localStartTime: minutesToTime(newStartMinutes) + ":00",
            localEndTime: minutesToTime(newStartMinutes + Math.max(0, durationMinutes)) + ":00",
          };
        },
        () => requestJson<EditResult>(`/api/trips/${encodeURIComponent(tripId)}/itinerary/reorder`, {
          itemId, expectedRevision: revisionRef.current, newDate, newStartTime,
        }),
      ),
    [commit, tripId],
  );

  const commitResize = useCallback(
    (itemId: string, newStartTime: string, durationMinutes: number) =>
      commit(
        itemId,
        (item) => ({ ...item, localStartTime: minutesToTime(timeToMinutes(newStartTime)) + ":00", localEndTime: minutesToTime(timeToMinutes(newStartTime) + durationMinutes) + ":00" }),
        () => {
          const item = items.find((entry) => entry.id === itemId);
          return requestJson<EditResult>(`/api/trips/${encodeURIComponent(tripId)}/itinerary/reorder`, {
            itemId, expectedRevision: revisionRef.current, newDate: item?.localDate, newStartTime, durationMinutes,
          });
        },
      ),
    [commit, items, tripId],
  );

  /** Schedules a pool POI onto the selected day. Unlike the edit paths there is no optimistic row
   * to mutate -- the item does not exist yet -- so this refetches on success instead. */
  const commitSchedule = useCallback(
    async (poiId: string, localDate: string, startTime: string, durationMinutes: number) => {
      try {
        // No itemType is sent: the server derives the canonical category from the catalog row, so a
        // client cannot mislabel a food venue to dodge the dietary gate.
        const result = await requestJson<EditResult>(`/api/trips/${encodeURIComponent(tripId)}/itinerary/schedule`, {
          poiId, expectedRevision: revisionRef.current, localDate, startTime, durationMinutes,
        });
        setRevision(result.revision);
        setItems((existing) => [...existing, result.item]);
        return { ok: true as const };
      } catch (cause) {
        if (cause instanceof ReorderRejected && cause.code === "CONFLICT") {
          await refetch();
          return { ok: false as const, reason: "Someone already changed this trip. Reloaded the latest plan." };
        }
        return { ok: false as const, reason: cause instanceof Error ? cause.message : "That place could not be scheduled." };
      }
    },
    [refetch, tripId],
  );

  /** Returns a block to the pool. The POI stays in the catalog; only the itinerary row goes. */
  const commitUnschedule = useCallback(
    async (itemId: string) => {
      const before = items;
      setItems((existing) => existing.filter((item) => item.id !== itemId));
      try {
        const result = await requestJson<{ poiId: string; revision: number }>(
          `/api/trips/${encodeURIComponent(tripId)}/itinerary/unschedule`,
          { itemId, expectedRevision: revisionRef.current },
        );
        setRevision(result.revision);
        return { ok: true as const };
      } catch (cause) {
        if (cause instanceof ReorderRejected && cause.code === "CONFLICT") {
          await refetch();
          return { ok: false as const, reason: "Someone already changed this trip. Reloaded the latest plan." };
        }
        const reason = cause instanceof Error ? cause.message : "That block could not be returned to the pool.";
        setItems(before.map((item) => (item.id === itemId ? { ...item, rejectedReason: reason } : item)));
        return { ok: false as const, reason };
      }
    },
    [items, refetch, tripId],
  );

  const commitUnlock = useCallback(
    (itemId: string) =>
      commit(
        itemId,
        (item) => ({ ...item, fixedCommitment: false }),
        () => requestJson<EditResult>(`/api/trips/${encodeURIComponent(tripId)}/itinerary/unlock`, {
          itemId, expectedRevision: revisionRef.current,
        }),
      ),
    [commit, tripId],
  );

  return useMemo(
    () => ({ items, revision, loading, loadError, commitDrag, commitResize, commitUnlock, commitSchedule, commitUnschedule }),
    [items, revision, loading, loadError, commitDrag, commitResize, commitUnlock, commitSchedule, commitUnschedule],
  );
}
