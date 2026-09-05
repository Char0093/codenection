import type { useDragCommit } from "@/features/timeline/use-drag-commit";

/**
 * Resize and unlock share `useDragCommit`'s items/revision state (they mutate the same itinerary,
 * and a resize immediately after a move must see that move's result, not a stale copy) -- this is
 * a thin, purpose-named view over that shared state rather than a second independent state owner.
 */
export function useResizeCommit(drag: ReturnType<typeof useDragCommit>) {
  return { commitResize: drag.commitResize, commitUnlock: drag.commitUnlock };
}
