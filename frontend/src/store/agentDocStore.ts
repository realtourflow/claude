import { create } from 'zustand';

export type DocType = 'baa' | 'listing_agreement' | 'purchase_contract' | 'disclosure' | 'other';

export type AgentDocTemplate = {
  id: string;
  agentId: string;
  name: string;
  docType: DocType;
  fileName: string;
  uploadedAt: string;
  notes?: string;
};

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  baa:               'Buyer Agency Agreement',
  listing_agreement: 'Exclusive Listing Agreement',
  purchase_contract: 'Purchase Contract',
  disclosure:        'Disclosure Form',
  other:             'Other',
};

type AgentDocStore = {
  docsByAgent: Record<string, AgentDocTemplate[]>;
  addDoc: (doc: AgentDocTemplate) => void;
  removeDoc: (docId: string) => void;
  updateDoc: (docId: string, patch: Partial<AgentDocTemplate>) => void;
};

export const useAgentDocStore = create<AgentDocStore>((set) => ({
  docsByAgent: {
    'agent-sarah': [
      {
        id: 'doc-baa-sarah',
        agentId: 'agent-sarah',
        name: 'Buyer Agency Agreement',
        docType: 'baa',
        fileName: 'Buyer_Agency_Agreement_Template.pdf',
        uploadedAt: '2026-01-15T10:00:00Z',
        notes: 'Standard BAA — valid 90 days from signing',
      },
      {
        id: 'doc-listing-sarah',
        agentId: 'agent-sarah',
        name: 'Exclusive Listing Agreement',
        docType: 'listing_agreement',
        fileName: 'Exclusive_Listing_Agreement_Template.pdf',
        uploadedAt: '2026-01-15T10:00:00Z',
      },
    ],
  },

  addDoc: (doc) =>
    set((state) => ({
      docsByAgent: {
        ...state.docsByAgent,
        [doc.agentId]: [...(state.docsByAgent[doc.agentId] ?? []), doc],
      },
    })),

  removeDoc: (docId) =>
    set((state) => ({
      docsByAgent: Object.fromEntries(
        Object.entries(state.docsByAgent).map(([agentId, docs]) => [
          agentId,
          docs.filter((d) => d.id !== docId),
        ])
      ),
    })),

  updateDoc: (docId, patch) =>
    set((state) => ({
      docsByAgent: Object.fromEntries(
        Object.entries(state.docsByAgent).map(([agentId, docs]) => [
          agentId,
          docs.map((d) => (d.id === docId ? { ...d, ...patch } : d)),
        ])
      ),
    })),
}));
