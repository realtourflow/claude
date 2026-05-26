"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

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

export function useContingencies(dealId: string) {
  const [items, setItems] = useState<Contingency[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    try {
      setLoading(true);
      const raw = await api.get<ApiContingency[]>(`/deals/${dealId}/contingencies`);
      setItems(raw.map(fromApi));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: ContingencyStatus) {
    setItems((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
    try {
      await api.patch(`/deals/${dealId}/contingencies/${id}`, { status });
    } catch {
      load();
    }
  }

  async function addItem(label: string, type: ContingencyType, deadline?: string) {
    try {
      const raw = await api.post<ApiContingency>(`/deals/${dealId}/contingencies`, {
        label,
        contingency_type: type,
        deadline: deadline || undefined,
      });
      setItems((prev) => [...prev, fromApi(raw)]);
    } catch {}
  }

  async function removeItem(id: string) {
    setItems((prev) => prev.filter((c) => c.id !== id));
    try {
      await api.delete(`/deals/${dealId}/contingencies/${id}`);
    } catch {
      load();
    }
  }

  return { items, loading, refresh: load, updateStatus, addItem, removeItem };
}

export function useAllContingenciesForDeals(dealIds: string[]) {
  const [contingencies, setContingencies] = useState<Contingency[]>([]);
  const key = dealIds.slice().sort().join(',');

  useEffect(() => {
    if (dealIds.length === 0) { setContingencies([]); return; }
    Promise.all(
      dealIds.map((id) => api.get<ApiContingency[]>(`/deals/${id}/contingencies`).catch(() => [] as ApiContingency[]))
    ).then((results) => {
      setContingencies(results.flat().map(fromApi));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return contingencies;
}
