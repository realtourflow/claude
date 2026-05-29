"use client";

import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type ContingencyStatus = 'active' | 'waived' | 'removed';
export type ContingencyType = 'inspection' | 'financing' | 'appraisal' | 'hoa' | 'custom';

export type Contingency = {
  id: string;
  dealId: string;
  label: string;
  type: ContingencyType;
  deadline?: string;
  status: ContingencyStatus;
  notes?: string;
  sortOrder: number;
};

type ApiContingency = {
  id: string;
  deal_id: string;
  label: string;
  contingency_type: string;
  deadline?: string;
  status: string;
  notes?: string;
  sort_order: number;
};

function fromApi(c: ApiContingency): Contingency {
  return {
    id: c.id,
    dealId: c.deal_id,
    label: c.label,
    type: (c.contingency_type || 'custom') as ContingencyType,
    deadline: c.deadline,
    status: c.status as ContingencyStatus,
    notes: c.notes,
    sortOrder: c.sort_order,
  };
}

export function useContingencies(dealId: string): {
  items: Contingency[];
  loading: boolean;
  refresh: () => void;
  updateStatus: (id: string, status: ContingencyStatus) => Promise<void>;
  addItem: (label: string, type: ContingencyType, deadline?: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const queryKey = ['contingencies', dealId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await api.get<ApiContingency[]>(`/deals/${dealId}/contingencies`);
      return raw.map(fromApi);
    },
    enabled: Boolean(dealId),
  });

  async function updateStatus(id: string, status: ContingencyStatus) {
    // Optimistic update via cache, then invalidate on error
    queryClient.setQueryData<Contingency[]>(queryKey, (prev) =>
      (prev ?? []).map((c) => (c.id === id ? { ...c, status } : c)),
    );
    try {
      await api.patch(`/deals/${dealId}/contingencies/${id}`, { status });
    } catch {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  async function addItem(label: string, type: ContingencyType, deadline?: string) {
    try {
      const raw = await api.post<ApiContingency>(`/deals/${dealId}/contingencies`, {
        label,
        contingency_type: type,
        deadline: deadline || undefined,
      });
      queryClient.setQueryData<Contingency[]>(queryKey, (prev) => [...(prev ?? []), fromApi(raw)]);
    } catch {}
  }

  async function removeItem(id: string) {
    queryClient.setQueryData<Contingency[]>(queryKey, (prev) =>
      (prev ?? []).filter((c) => c.id !== id),
    );
    try {
      await api.delete(`/deals/${dealId}/contingencies/${id}`);
    } catch {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    updateStatus,
    addItem,
    removeItem,
  };
}

export function useAllContingenciesForDeals(dealIds: string[]): Contingency[] {
  const queries = useQueries({
    queries: dealIds.map((id) => ({
      queryKey: ['contingencies', id],
      queryFn: async () => {
        try {
          const raw = await api.get<ApiContingency[]>(`/deals/${id}/contingencies`);
          return raw.map(fromApi);
        } catch {
          return [] as Contingency[];
        }
      },
      enabled: Boolean(id),
    })),
  });

  return queries.flatMap((q) => q.data ?? []);
}
