"use client";

import { useCallback, useState } from "react";
import { patchTaskStatus } from "@/hooks/useTasks";

/**
 * Shared task-completion logic for the buyer & seller portals.
 *
 * Clients used to fake completion with a write-only `completedIds` Set and no
 * API call (#79). This hook does the real thing: it optimistically marks the
 * task done, calls patchTaskStatus(id, 'completed') so the agent/TC see it and
 * it survives a reload, then refetches so the server is the source of truth.
 * On failure it rolls the optimistic check back and surfaces a visible error.
 *
 * `completedIds` is the in-flight optimistic layer the list filters on; once the
 * refetch lands, the task's real status is 'completed' so callers should union
 * (not add) the two when counting to avoid double-counting.
 */
export function useTaskCompletion(refetch?: () => void): {
  completedIds: Set<string>;
  error: string | null;
  clearError: () => void;
  complete: (id: string) => Promise<void>;
} {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const complete = useCallback(
    async (id: string) => {
      setError(null);
      // Optimistic: check it off immediately.
      setCompletedIds((prev) => new Set(prev).add(id));
      try {
        await patchTaskStatus(id, "completed");
        refetch?.();
      } catch {
        // Roll the optimistic check back and tell the user.
        setCompletedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setError("Couldn't mark that task complete. Please try again.");
      }
    },
    [refetch],
  );

  return {
    completedIds,
    error,
    clearError: useCallback(() => setError(null), []),
    complete,
  };
}
