"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {
  apiStageHistoryListSchema,
  type ApiStageHistory,
} from "@/lib/schemas/stage-history";
import { checkWire } from "@/lib/schemas/wire";

// The wire type is inferred from the zod schema (#88) — one contract shared
// with the server boundary instead of a hand-maintained copy.
export type { ApiStageHistory };

/**
 * Fetch a deal's stage-transition log (#256). Ordered ascending by
 * `changed_at`; the Timeline tab derives per-stage durations from it. Empty
 * for a deal that hasn't advanced yet.
 */
export function useStageHistory(
  dealId: string
): { history: ApiStageHistory[]; loading: boolean } {
  const query = useQuery({
    queryKey: ["stage-history", dealId],
    queryFn: async () => {
      // Dev/test-only wire check (#88): warns on schema drift; no-op in prod.
      const raw = await api.get<ApiStageHistory[]>(`/deals/${dealId}/stage-history`);
      return checkWire(
        apiStageHistoryListSchema,
        raw,
        "GET /api/deals/:id/stage-history"
      );
    },
    enabled: Boolean(dealId),
  });

  return {
    history: query.data ?? [],
    loading: query.isLoading,
  };
}
