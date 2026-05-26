"use client";

import { create } from 'zustand';
import { PreferredVendor, VendorCategory, MOCK_PREFERRED_VENDORS } from "@/lib/data/mockVendors";

function genId() {
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type VendorStore = {
  vendors: PreferredVendor[];
  addVendor: (vendor: Omit<PreferredVendor, 'id'>) => void;
  updateVendor: (id: string, updates: Partial<Omit<PreferredVendor, 'id'>>) => void;
  deleteVendor: (id: string) => void;
  moveVendor: (id: string, direction: 'up' | 'down') => void;
  toggleFeatured: (id: string) => void;
  getByAgent: (agentId: string) => PreferredVendor[];
  getByCategory: (agentId: string, category: VendorCategory) => PreferredVendor[];
};

export const useVendorStore = create<VendorStore>((set, get) => ({
  vendors: [...MOCK_PREFERRED_VENDORS],

  addVendor: (vendor) =>
    set((s) => ({ vendors: [...s.vendors, { ...vendor, id: genId() }] })),

  updateVendor: (id, updates) =>
    set((s) => ({
      vendors: s.vendors.map((v) => (v.id === id ? { ...v, ...updates } : v)),
    })),

  deleteVendor: (id) =>
    set((s) => ({ vendors: s.vendors.filter((v) => v.id !== id) })),

  moveVendor: (id, direction) =>
    set((s) => {
      const vendors = [...s.vendors];
      const idx = vendors.findIndex((v) => v.id === id);
      if (idx === -1) return s;
      const { category, agentId } = vendors[idx];

      const sameCat = vendors
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => v.category === category && v.agentId === agentId);

      const posInCat = sameCat.findIndex(({ i }) => i === idx);
      if (direction === 'up' && posInCat > 0) {
        const swapIdx = sameCat[posInCat - 1].i;
        [vendors[idx], vendors[swapIdx]] = [vendors[swapIdx], vendors[idx]];
      } else if (direction === 'down' && posInCat < sameCat.length - 1) {
        const swapIdx = sameCat[posInCat + 1].i;
        [vendors[idx], vendors[swapIdx]] = [vendors[swapIdx], vendors[idx]];
      }
      return { vendors };
    }),

  toggleFeatured: (id) =>
    set((s) => ({
      vendors: s.vendors.map((v) => (v.id === id ? { ...v, isFeatured: !v.isFeatured } : v)),
    })),

  getByAgent: (agentId) => get().vendors.filter((v) => v.agentId === agentId),

  getByCategory: (agentId, category) =>
    get().vendors.filter((v) => v.agentId === agentId && v.category === category),
}));
