import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Deal, DealStage } from '../data/mockDeals';

export type ApiDeal = {
  id: string;
  agent_id: string;
  type: 'buy' | 'sell';
  stage: string;
  health: 'green' | 'yellow' | 'red';
  title: string;
  address: string | null;
  price: number | null;
  arive_linked: boolean;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string | null;
  open_task_count?: number;
  overdue_task_count?: number;
};

export function apiDealToFrontend(d: ApiDeal): Deal {
  const price = d.price ?? 0;
  return {
    id: d.id,
    type: d.type,
    clientName: d.title,
    clientId: '',
    agentId: d.agent_id,
    stage: d.stage as DealStage,
    health: d.health ?? 'green',
    priority: 'medium',
    property: {
      address: d.address ?? 'TBD',
      city: '',
      state: '',
      zip: '',
      price,
    },
    timeline: {
      createdAt: d.created_at,
      daysInStage: Math.max(
        0,
        Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86_400_000),
      ),
    },
    flags: d.arive_linked ? ['mountain_mortgage'] : [],
    status: 'active',
    estimatedCommission: Math.round(price * 0.03),
    agentName: d.agent_name,
    agentEmail: d.agent_email,
    agentPhone: d.agent_phone,
    openTaskCount: d.open_task_count ?? 0,
    overdueTaskCount: d.overdue_task_count ?? 0,
  };
}

export function useDeal(id: string | undefined) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<ApiDeal>(`/deals/${id}`);
      setDeal(apiDealToFrontend(raw));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deal');
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { deal, loading, error, refresh: load };
}

export async function patchStage(dealId: string, stage: string): Promise<ApiDeal> {
  return api.patch<ApiDeal>(`/deals/${dealId}/stage`, { stage });
}

export function useDeals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<ApiDeal[]>('/deals');
      setDeals(raw.map(apiDealToFrontend));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { deals, loading, error, refresh: load };
}
