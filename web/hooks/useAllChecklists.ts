"use client";

import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ChecklistItem, ChecklistAssignee } from "@/hooks/useChecklist";

// Wire shape mirrors useChecklist's private ApiItem. It's replicated here rather
// than imported because useChecklist.ts intentionally doesn't export its mapping
// (and is left untouched); the two must stay in sync.
type ApiItem = {
  id: string;
  deal_id: string;
  label: string;
  category: string;
  checked: boolean;
  assigned_to: string;
  due_date?: string;
  is_custom: boolean;
  sort_order: number;
};

function fromApi(a: ApiItem): ChecklistItem {
  return {
    id: a.id,
    dealId: a.deal_id,
    label: a.label,
    category: a.category,
    checked: a.checked,
    assignedTo: a.assigned_to as ChecklistAssignee,
    dueDate: a.due_date,
    isCustom: a.is_custom,
    sortOrder: a.sort_order,
  };
}

/**
 * Aggregate every checklist item across a set of deals — the checklist analogue
 * of useAllContingenciesForDeals. Reuses the same per-deal ['checklist', dealId]
 * query cache as useChecklist, so the two never double-fetch. A single deal's
 * fetch failing yields [] for that deal instead of blanking the whole list.
 *
 * Used by the TC Deadlines view to surface checklist due dates alongside task
 * and contingency deadlines.
 */
export function useAllChecklistsForDeals(dealIds: string[]): ChecklistItem[] {
  const queries = useQueries({
    queries: dealIds.map((id) => ({
      queryKey: ["checklist", id],
      queryFn: async () => {
        try {
          const raw = await api.get<ApiItem[]>(`/deals/${id}/checklist`);
          return raw.map(fromApi);
        } catch {
          return [] as ChecklistItem[];
        }
      },
      enabled: Boolean(id),
    })),
  });

  return queries.flatMap((q) => q.data ?? []);
}
