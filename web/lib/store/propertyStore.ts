"use client";

import { create } from 'zustand';
import { TrackedProperty, PropertyStatus, MOCK_TRACKED_PROPERTIES } from "@/lib/data/mockProperties";

export type { TrackedProperty, PropertyStatus };

type PropertyStore = {
  propertiesByDeal: Record<string, TrackedProperty[]>;
  addProperty: (property: TrackedProperty) => void;
  updateStatus: (propertyId: string, status: PropertyStatus) => void;
  removeProperty: (propertyId: string) => void;
  updateBuyerNote: (propertyId: string, note: string) => void;
  updateAgentNote: (propertyId: string, note: string) => void;
  setOfferRequested: (propertyId: string, value: boolean) => void;
};

const initial: Record<string, TrackedProperty[]> = {};
for (const prop of MOCK_TRACKED_PROPERTIES) {
  if (!initial[prop.dealId]) initial[prop.dealId] = [];
  initial[prop.dealId].push(prop);
}

export const usePropertyStore = create<PropertyStore>((set) => ({
  propertiesByDeal: initial,

  addProperty: (property) =>
    set((state) => ({
      propertiesByDeal: {
        ...state.propertiesByDeal,
        [property.dealId]: [...(state.propertiesByDeal[property.dealId] ?? []), property],
      },
    })),

  updateStatus: (propertyId, status) =>
    set((state) => ({
      propertiesByDeal: Object.fromEntries(
        Object.entries(state.propertiesByDeal).map(([dealId, props]) => [
          dealId,
          props.map((p) => (p.id === propertyId ? { ...p, status } : p)),
        ])
      ),
    })),

  removeProperty: (propertyId) =>
    set((state) => ({
      propertiesByDeal: Object.fromEntries(
        Object.entries(state.propertiesByDeal).map(([dealId, props]) => [
          dealId,
          props.filter((p) => p.id !== propertyId),
        ])
      ),
    })),

  updateBuyerNote: (propertyId, note) =>
    set((state) => ({
      propertiesByDeal: Object.fromEntries(
        Object.entries(state.propertiesByDeal).map(([dealId, props]) => [
          dealId,
          props.map((p) => (p.id === propertyId ? { ...p, buyerNote: note } : p)),
        ])
      ),
    })),

  updateAgentNote: (propertyId, note) =>
    set((state) => ({
      propertiesByDeal: Object.fromEntries(
        Object.entries(state.propertiesByDeal).map(([dealId, props]) => [
          dealId,
          props.map((p) => (p.id === propertyId ? { ...p, agentPrivateNote: note } : p)),
        ])
      ),
    })),

  setOfferRequested: (propertyId, value) =>
    set((state) => ({
      propertiesByDeal: Object.fromEntries(
        Object.entries(state.propertiesByDeal).map(([dealId, props]) => [
          dealId,
          props.map((p) => (p.id === propertyId ? { ...p, offerRequested: value } : p)),
        ])
      ),
    })),
}));
