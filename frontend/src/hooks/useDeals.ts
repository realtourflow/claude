import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Deal, DealStage } from '../data/mockDeals';

export type ApiDeal = {
  id: string;
  agent_id: string;
  type: 'buy' | 'sell';
  stage: string;
  title: string;
  address: string | null;
  price: number | null;
  arive_linked: boolean;
  created_at: string;
  updated_at: string;
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
    health: 'green',
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
  };
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
