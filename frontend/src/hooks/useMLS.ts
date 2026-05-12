import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

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
  remarks: string;
};

export type MLSSearchParams = {
  minPrice?: number;
  maxPrice?: number;
  cities?: string[];
  minBeds?: number;
};

export function useMLSConnection() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ connected: boolean }>('/me/mls')
      .then((r) => setConnected(r.connected))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveMLS(key: string, secret: string): Promise<void> {
    const r = await api.patch<{ ok: boolean; connected: boolean }>('/me/mls', { key, secret });
    setConnected(r.connected);
  }

  async function disconnectMLS(): Promise<void> {
    await api.patch('/me/mls', { key: '', secret: '' });
    setConnected(false);
  }

  return { connected, loading, saveMLS, disconnectMLS };
}

export function useMLSListings(dealId: string | null) {
  const [listings, setListings] = useState<MLSListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback((params: MLSSearchParams) => {
    if (!dealId) return;
    setLoading(true);
    setError('');

    const qs = new URLSearchParams();
    if (params.minPrice) qs.set('minprice', String(params.minPrice));
    if (params.maxPrice) qs.set('maxprice', String(params.maxPrice));
    if (params.cities?.length) params.cities.forEach((c) => qs.append('cities', c));
    if (params.minBeds) qs.set('minbeds', String(params.minBeds));

    api.get<MLSListing[]>(`/deals/${dealId}/listings/search?${qs}`)
      .then(setListings)
      .catch((e) => setError(e?.message ?? 'Failed to load listings'))
      .finally(() => setLoading(false));
  }, [dealId]);

  return { listings, loading, error, search };
}
