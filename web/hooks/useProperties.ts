"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from "@/lib/api-client";

export type PropertyStatus = 'interested' | 'toured' | 'not_for_me' | 'offer_submitted';

export type TrackedProperty = {
  id: string;
  dealId: string;
  address: string;
  city: string;
  state: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  thumbnailUrl: string;
  sourceUrl: string;
  status: PropertyStatus;
  addedBy: 'buyer' | 'agent';
  agentNote?: string;
  buyerNote?: string;
  agentPrivateNote?: string;
  offerRequested?: boolean;
};

type ApiProperty = {
  id: string;
  deal_id: string;
  address: string;
  city: string;
  state: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  thumbnail_url: string;
  source_url: string;
  status: string;
  added_by: string;
  agent_note?: string | null;
  buyer_note?: string | null;
  agent_private_note?: string | null;
  offer_requested: boolean;
};

function fromApi(p: ApiProperty): TrackedProperty {
  return {
    id: p.id,
    dealId: p.deal_id,
    address: p.address,
    city: p.city,
    state: p.state,
    price: p.price,
    beds: p.beds,
    baths: p.baths,
    sqft: p.sqft,
    thumbnailUrl: p.thumbnail_url,
    sourceUrl: p.source_url,
    status: p.status as PropertyStatus,
    addedBy: p.added_by as 'buyer' | 'agent',
    agentNote: p.agent_note ?? undefined,
    buyerNote: p.buyer_note ?? undefined,
    agentPrivateNote: p.agent_private_note ?? undefined,
    offerRequested: p.offer_requested,
  };
}

export function useProperties(dealId: string | undefined) {
  const [properties, setProperties] = useState<TrackedProperty[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    try {
      setLoading(true);
      const raw = await api.get<ApiProperty[]>(`/deals/${dealId}/properties`);
      setProperties(raw.map(fromApi));
    } catch {
      setProperties([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  async function addProperty(p: Omit<TrackedProperty, 'id'>) {
    if (!dealId) return;
    const raw = await api.post<ApiProperty>(`/deals/${dealId}/properties`, {
      address: p.address,
      city: p.city,
      state: p.state,
      price: p.price,
      beds: p.beds,
      baths: p.baths,
      sqft: p.sqft,
      thumbnail_url: p.thumbnailUrl,
      source_url: p.sourceUrl,
      status: p.status,
      added_by: p.addedBy,
      agent_note: p.agentNote,
      buyer_note: p.buyerNote,
    });
    setProperties((prev) => [...prev, fromApi(raw)]);
  }

  async function removeProperty(propertyId: string) {
    await api.delete(`/properties/${propertyId}`);
    setProperties((prev) => prev.filter((p) => p.id !== propertyId));
  }

  async function updateStatus(propertyId: string, status: PropertyStatus) {
    await api.patch(`/properties/${propertyId}`, { status });
    setProperties((prev) => prev.map((p) => p.id === propertyId ? { ...p, status } : p));
  }

  async function updateBuyerNote(propertyId: string, buyerNote: string) {
    await api.patch(`/properties/${propertyId}`, { buyer_note: buyerNote });
    setProperties((prev) => prev.map((p) => p.id === propertyId ? { ...p, buyerNote } : p));
  }

  async function updateAgentNote(propertyId: string, agentPrivateNote: string) {
    await api.patch(`/properties/${propertyId}`, { agent_private_note: agentPrivateNote });
    setProperties((prev) => prev.map((p) => p.id === propertyId ? { ...p, agentPrivateNote } : p));
  }

  async function setOfferRequested(propertyId: string, offerRequested: boolean) {
    await api.patch(`/properties/${propertyId}`, { offer_requested: offerRequested });
    setProperties((prev) => prev.map((p) => p.id === propertyId ? { ...p, offerRequested } : p));
  }

  return { properties, loading, refresh: load, addProperty, removeProperty, updateStatus, updateBuyerNote, updateAgentNote, setOfferRequested };
}
