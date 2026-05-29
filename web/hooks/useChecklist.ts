"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type ChecklistAssignee = 'tc' | 'agent' | 'buyer' | 'seller' | 'third_party';

export type ChecklistItem = {
  id: string;
  dealId: string;
  label: string;
  category: string;
  checked: boolean;
  assignedTo: ChecklistAssignee;
  dueDate?: string;
  isCustom: boolean;
  sortOrder: number;
};

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

export function useChecklist(dealId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['checklist', dealId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await api.get<ApiItem[]>(`/deals/${dealId}/checklist`);
      return raw.map(fromApi);
    },
    enabled: Boolean(dealId),
  });

  const items = query.data ?? [];

  const update = (mut: (prev: ChecklistItem[]) => ChecklistItem[]) => {
    queryClient.setQueryData<ChecklistItem[]>(queryKey, (prev) => mut(prev ?? []));
  };

  async function toggle(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    update((prev) => prev.map((i) => (i.id === itemId ? { ...i, checked: !i.checked } : i)));
    try {
      await api.patch(`/deals/${dealId}/checklist/${itemId}`, { checked: !item.checked });
    } catch {
      update((prev) => prev.map((i) => (i.id === itemId ? { ...i, checked: item.checked } : i)));
    }
  }

  async function assign(itemId: string, assignedTo: ChecklistAssignee) {
    update((prev) => prev.map((i) => (i.id === itemId ? { ...i, assignedTo } : i)));
    try {
      await api.patch(`/deals/${dealId}/checklist/${itemId}`, { assigned_to: assignedTo });
    } catch {
      void query.refetch();
    }
  }

  async function setDueDate(itemId: string, dueDate: string | undefined) {
    update((prev) => prev.map((i) => (i.id === itemId ? { ...i, dueDate } : i)));
    try {
      await api.patch(`/deals/${dealId}/checklist/${itemId}`, { due_date: dueDate ?? '' });
    } catch {
      void query.refetch();
    }
  }

  async function addItem(label: string, category: string) {
    try {
      const raw = await api.post<ApiItem>(`/deals/${dealId}/checklist`, { label, category, assigned_to: 'tc' });
      update((prev) => [...prev, fromApi(raw)]);
    } catch {}
  }

  async function removeItem(itemId: string) {
    update((prev) => prev.filter((i) => i.id !== itemId));
    try {
      await api.delete(`/deals/${dealId}/checklist/${itemId}`);
    } catch {
      void query.refetch();
    }
  }

  return {
    items,
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    toggle,
    assign,
    setDueDate,
    addItem,
    removeItem,
  };
}
