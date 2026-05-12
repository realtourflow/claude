import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export type Offer = {
  id: string;
  dealId: string;
  buyerName: string;
  offerPrice: number;
  closeDate?: string;
  contingencies: string[];
  agentNotes: string;
  submittedAt: string;
};

type ApiOffer = {
  id: string;
  deal_id: string;
  buyer_name: string;
  offer_price: number;
  close_date?: string | null;
  contingencies: string[];
  agent_notes: string;
  submitted_at: string;
};

function fromApi(o: ApiOffer): Offer {
  return {
    id: o.id,
    dealId: o.deal_id,
    buyerName: o.buyer_name,
    offerPrice: o.offer_price,
    closeDate: o.close_date ?? undefined,
    contingencies: o.contingencies ?? [],
    agentNotes: o.agent_notes,
    submittedAt: o.submitted_at,
  };
}

export function useOffers(dealId: string | undefined) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    try {
      setLoading(true);
      const raw = await api.get<ApiOffer[]>(`/deals/${dealId}/offers`);
      setOffers(raw.map(fromApi));
    } catch {
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  async function addOffer(o: Omit<Offer, 'id' | 'dealId' | 'submittedAt'>) {
    if (!dealId) return;
    const raw = await api.post<ApiOffer>(`/deals/${dealId}/offers`, {
      buyer_name: o.buyerName,
      offer_price: o.offerPrice,
      close_date: o.closeDate || null,
      contingencies: o.contingencies,
      agent_notes: o.agentNotes,
    });
    setOffers((prev) => [fromApi(raw), ...prev]);
  }

  async function removeOffer(offerId: string) {
    await api.delete(`/offers/${offerId}`);
    setOffers((prev) => prev.filter((o) => o.id !== offerId));
  }

  return { offers, loading, refresh: load, addOffer, removeOffer };
}
