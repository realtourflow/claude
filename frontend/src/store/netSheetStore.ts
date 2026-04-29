import { create } from 'zustand';

export type NetSheet = {
  salePrice: number;
  commissionPct: number;
  closingCostsPct: number;
  mortgagePayoff: number;
  otherDeductions: number;
  otherDeductionsLabel: string;
};

export function calcNetProceeds(sheet: NetSheet) {
  const commission = Math.round(sheet.salePrice * sheet.commissionPct / 100);
  const closingCosts = Math.round(sheet.salePrice * sheet.closingCostsPct / 100);
  const netProceeds = sheet.salePrice - commission - closingCosts - sheet.mortgagePayoff - sheet.otherDeductions;
  return { commission, closingCosts, netProceeds };
}

type NetSheetStore = {
  netSheetByDeal: Record<string, NetSheet>;
  setNetSheet: (dealId: string, sheet: NetSheet) => void;
};

export const useNetSheetStore = create<NetSheetStore>((set) => ({
  netSheetByDeal: {},
  setNetSheet: (dealId, sheet) =>
    set((state) => ({
      netSheetByDeal: { ...state.netSheetByDeal, [dealId]: sheet },
    })),
}));
