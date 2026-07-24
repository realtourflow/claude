"use client";

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type MLSListing = {
  mlsId: string;
  listPrice: number;
  address: {
    full: string;
    city: string;
    state: string;
    postalCode: string;
  };
  property: {
    bedrooms: number;
    bathsFull: number;
    area: number;
    subType: string;
  };
  photos: string[];
  mls: {
    status: string;
    daysOnMarket: number;
  };
  /** Only present on CLOSED listings — drives comparable-sales analysis (#374). */
  sales?: {
    closePrice: number;
    closeDate: string;
  };
  remarks: string;
};

export type MLSSearchParams = {
  minPrice?: number;
  maxPrice?: number;
  cities?: string[];
  minBeds?: number;
};

export function useMLSConnection() {
  const queryClient = useQueryClient();
  const queryKey = ['me-mls'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await api.get<{ connected: boolean }>('/me/mls');
      } catch {
        return { connected: false };
      }
    },
  });

  async function saveMLS(key: string, secret: string): Promise<void> {
    const r = await api.patch<{ ok: boolean; connected: boolean }>('/me/mls', { key, secret });
    queryClient.setQueryData(queryKey, { connected: r.connected });
  }

  async function disconnectMLS(): Promise<void> {
    await api.patch('/me/mls', { key: '', secret: '' });
    queryClient.setQueryData(queryKey, { connected: false });
  }

  return {
    connected: query.data?.connected ?? false,
    loading: query.isLoading,
    saveMLS,
    disconnectMLS,
  };
}

export function useMLSListings(dealId: string | null) {
  const mutation = useMutation({
    mutationFn: async (params: MLSSearchParams) => {
      if (!dealId) return [] as MLSListing[];
      const qs = new URLSearchParams();
      if (params.minPrice) qs.set('minprice', String(params.minPrice));
      if (params.maxPrice) qs.set('maxprice', String(params.maxPrice));
      if (params.cities?.length) params.cities.forEach((c) => qs.append('cities', c));
      if (params.minBeds) qs.set('minbeds', String(params.minBeds));
      return api.get<MLSListing[]>(`/deals/${dealId}/listings/search?${qs}`);
    },
  });

  const search = useCallback(
    (params: MLSSearchParams) => {
      if (!dealId) return;
      mutation.mutate(params);
    },
    [dealId, mutation],
  );

  return {
    listings: mutation.data ?? [],
    loading: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : '',
    search,
  };
}
