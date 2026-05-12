import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Deal } from '../data/mockDeals';
import { apiDealToFrontend, ApiDeal } from './useDeals';

type ApiMyDeal = ApiDeal & {
  agent_name: string;
  agent_email: string;
  agent_phone: string | null;
};

export type MyDeal = Deal & {
  agentName: string;
  agentEmail: string;
  agentPhone: string | null;
};

function apiMyDealToFrontend(d: ApiMyDeal): MyDeal {
  return {
    ...apiDealToFrontend(d),
    agentName: d.agent_name,
    agentEmail: d.agent_email,
    agentPhone: d.agent_phone,
  };
}

export function useMyDeals() {
  const [deals, setDeals] = useState<MyDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<ApiMyDeal[]>('/me/deals');
      setDeals(raw.map(apiMyDealToFrontend));
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
