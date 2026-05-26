"use client";

import { create } from 'zustand';

export type Offer = {
  id: string;
  dealId: string;
  buyerName: string;
  offerPrice: number;
  closeDate: string;
  contingencies: string[];
  agentNotes: string;
  submittedAt: string;
};

type OfferStore = {
  offersByDeal: Record<string, Offer[]>;
  addOffer: (offer: Offer) => void;
  removeOffer: (offerId: string, dealId: string) => void;
};

export const useOfferStore = create<OfferStore>((set) => ({
  offersByDeal: {},
  addOffer: (offer) =>
    set((state) => ({
      offersByDeal: {
        ...state.offersByDeal,
        [offer.dealId]: [...(state.offersByDeal[offer.dealId] ?? []), offer],
      },
    })),
  removeOffer: (offerId, dealId) =>
    set((state) => ({
      offersByDeal: {
        ...state.offersByDeal,
        [dealId]: (state.offersByDeal[dealId] ?? []).filter((o) => o.id !== offerId),
      },
    })),
}));
