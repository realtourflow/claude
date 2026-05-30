"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Deal } from "@/lib/data/mockDeals";
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

export function useMyDeals(): {
  deals: MyDeal[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const query = useQuery({
    queryKey: ['my-deals'],
    queryFn: async () => {
      const raw = await api.get<ApiMyDeal[]>('/me/deals');
      return raw.map(apiMyDealToFrontend);
    },
  });

  return {
    deals: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => { void query.refetch(); },
  };
}
