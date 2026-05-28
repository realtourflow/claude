"use client";

import { create } from 'zustand';

type PreApprovalStore = {
  preApprovedByDeal: Record<string, boolean>;
  baaSignedByDeal: Record<string, boolean>;
  setPreApproved: (dealId: string, value: boolean) => void;
  setBaaSigned: (dealId: string, value: boolean) => void;
};

export const usePreApprovalStore = create<PreApprovalStore>((set) => ({
  preApprovedByDeal: {
    'deal-smith': true,
    'deal-garcia': true,
  },
  baaSignedByDeal: {
    'deal-smith': true,
    'deal-garcia': true,
  },
  setPreApproved: (dealId, value) =>
    set((state) => ({
      preApprovedByDeal: { ...state.preApprovedByDeal, [dealId]: value },
    })),
  setBaaSigned: (dealId, value) =>
    set((state) => ({
      baaSignedByDeal: { ...state.baaSignedByDeal, [dealId]: value },
    })),
}));
