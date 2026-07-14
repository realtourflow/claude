"use client";

import { create } from 'zustand';
import { DealStage, MOCK_DEALS } from "@/lib/data/mockDeals";

// Buyer status is persisted server-side (deals.buyer_status, #184) — it must
// never come back here as client-store state, or the seller stops seeing it.
type DealStageStore = {
  stageByDeal: Record<string, DealStage>;
  setStage: (dealId: string, stage: DealStage) => void;
};

const initialStages: Record<string, DealStage> = {};
for (const deal of MOCK_DEALS) {
  initialStages[deal.id] = deal.stage;
}

export const useDealStageStore = create<DealStageStore>((set) => ({
  stageByDeal: initialStages,
  setStage: (dealId, stage) =>
    set((state) => ({
      stageByDeal: { ...state.stageByDeal, [dealId]: stage },
    })),
}));
