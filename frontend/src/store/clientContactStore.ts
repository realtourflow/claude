import { create } from 'zustand';

export type ClientContact = {
  name: string;
  phone: string;
  email: string;
};

type ClientContactStore = {
  contacts: Record<string, ClientContact>;
  setContact: (dealId: string, contact: ClientContact) => void;
  getContact: (dealId: string) => ClientContact | null;
};

export const useClientContactStore = create<ClientContactStore>((set, get) => ({
  contacts: {},
  setContact: (dealId, contact) =>
    set((state) => ({ contacts: { ...state.contacts, [dealId]: contact } })),
  getContact: (dealId) => get().contacts[dealId] ?? null,
}));
