"use client";

import { create } from 'zustand';
import { DealStage, MOCK_DEALS } from "@/lib/data/mockDeals";

type DealStageStore = {
  stageByDeal: Record<string, DealStage>;
  setStage: (dealId: string, stage: DealStage) => void;
  buyerStatusByDeal: Record<string, string>;
  setBuyerStatus: (dealId: string, status: string) => void;
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
  buyerStatusByDeal: {},
  setBuyerStatus: (dealId, status) =>
    set((state) => ({
      buyerStatusByDeal: { ...state.buyerStatusByDeal, [dealId]: status },
    })),
}));
