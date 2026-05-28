"use client";

import { create } from 'zustand';
import { MOCK_DEALS } from "@/lib/data/mockDeals";

export type ChecklistAssignee = 'tc' | 'agent' | 'buyer' | 'seller' | 'third_party';

export type ChecklistItem = {
  id: string;
  dealId: string;
  label: string;
  category: string;
  checked: boolean;
  assignedTo: ChecklistAssignee;
  dueDate?: string;
  isCustom: boolean;
};

// Stages that trigger the default under-contract checklist
const CHECKLIST_STAGES = new Set(['under_contract', 'pre_close', 'closing', 'post_close']);

const DEFAULT_ITEMS: Omit<ChecklistItem, 'id' | 'dealId' | 'checked' | 'isCustom'>[] = [
  // Contract
  { label: 'Contract received and reviewed',      category: 'Contract', assignedTo: 'tc' },
  { label: 'Earnest money deposit verified',      category: 'Contract', assignedTo: 'tc' },
  { label: 'All parties have signed contract',    category: 'Contract', assignedTo: 'tc' },
  // Loan
  { label: 'Loan application submitted',          category: 'Loan', assignedTo: 'tc' },
  { label: 'Disclosures out',                     category: 'Loan', assignedTo: 'tc' },
  { label: 'Disclosures signed and submitted',    category: 'Loan', assignedTo: 'tc' },
  { label: 'Approved with conditions',            category: 'Loan', assignedTo: 'tc' },
  { label: 'Appraisal ordered',                   category: 'Loan', assignedTo: 'tc' },
  { label: 'Clear to close received',             category: 'Loan', assignedTo: 'tc' },
  // Title
  { label: 'Title ordered',                       category: 'Title', assignedTo: 'tc' },
  { label: 'Title search complete',               category: 'Title', assignedTo: 'tc' },
  { label: 'Title commitment received',           category: 'Title', assignedTo: 'tc' },
  { label: 'Wire instructions confirmed',         category: 'Title', assignedTo: 'tc' },
  // Closing
  { label: 'Closing date confirmed with all parties', category: 'Closing', assignedTo: 'tc' },
  { label: 'Closing disclosure sent',             category: 'Closing', assignedTo: 'tc' },
  { label: 'Final walkthrough scheduled',         category: 'Closing', assignedTo: 'agent' },
  { label: 'Keys and access items prepared',      category: 'Closing', assignedTo: 'tc' },
];

function buildDefaultItems(dealId: string): ChecklistItem[] {
  return DEFAULT_ITEMS.map((item, i) => ({
    ...item,
    id: `${dealId}-cl-${i}`,
    dealId,
    checked: false,
    isCustom: false,
  }));
}

// Pre-seed checked state from existing milestone data
function applyMilestoneState(items: ChecklistItem[], dealId: string): ChecklistItem[] {
  const deal = MOCK_DEALS.find((d) => d.id === dealId);
  const m = deal?.loanMilestones;

  const autoChecked: Record<string, boolean> = {
    // Contract items are done if we're under contract
    'Contract received and reviewed': true,
    'Earnest money deposit verified': true,
    'All parties have signed contract': true,
    // Loan — derive from milestone data
    'Loan application submitted': m?.loanSetup ?? false,
    'Disclosures out': m?.disclosuresOut ?? false,
    'Disclosures signed and submitted': m?.disclosuresSignedSubmitted ?? false,
    'Approved with conditions': m?.approvedWithConditions ?? false,
    'Appraisal ordered': (m?.appraisal === 'ordered' || m?.appraisal === 'scheduled' || m?.appraisal === 'complete') ?? false,
    'Clear to close received': m?.clearToClose ?? false,
    // Title — ordered once under contract
    'Title ordered': true,
  };

  return items.map((item) => ({
    ...item,
    checked: autoChecked[item.label] ?? item.checked,
  }));
}

// Initialize store with default checklists for all eligible active deals
const initialItems: Record<string, ChecklistItem[]> = {};
MOCK_DEALS.forEach((deal) => {
  if (CHECKLIST_STAGES.has(deal.stage) && deal.status === 'active') {
    const base = buildDefaultItems(deal.id);
    initialItems[deal.id] = applyMilestoneState(base, deal.id);
  }
});

type ChecklistStore = {
  itemsByDeal: Record<string, ChecklistItem[]>;
  /** Ensure a deal has a checklist (call when stage advances to under_contract) */
  initDeal: (dealId: string) => void;
  toggle: (dealId: string, itemId: string) => void;
  assign: (dealId: string, itemId: string, assignedTo: ChecklistAssignee) => void;
  setDueDate: (dealId: string, itemId: string, dueDate: string | undefined) => void;
  addItem: (dealId: string, label: string, category: string) => void;
  removeItem: (dealId: string, itemId: string) => void;
};

export const useChecklistStore = create<ChecklistStore>((set, get) => ({
  itemsByDeal: initialItems,

  initDeal: (dealId) => {
    if (get().itemsByDeal[dealId]) return;
    const base = buildDefaultItems(dealId);
    const seeded = applyMilestoneState(base, dealId);
    set((state) => ({ itemsByDeal: { ...state.itemsByDeal, [dealId]: seeded } }));
  },

  toggle: (dealId, itemId) =>
    set((state) => ({
      itemsByDeal: {
        ...state.itemsByDeal,
        [dealId]: (state.itemsByDeal[dealId] ?? []).map((item) =>
          item.id === itemId ? { ...item, checked: !item.checked } : item
        ),
      },
    })),

  assign: (dealId, itemId, assignedTo) =>
    set((state) => ({
      itemsByDeal: {
        ...state.itemsByDeal,
        [dealId]: (state.itemsByDeal[dealId] ?? []).map((item) =>
          item.id === itemId ? { ...item, assignedTo } : item
        ),
      },
    })),

  setDueDate: (dealId, itemId, dueDate) =>
    set((state) => ({
      itemsByDeal: {
        ...state.itemsByDeal,
        [dealId]: (state.itemsByDeal[dealId] ?? []).map((item) =>
          item.id === itemId ? { ...item, dueDate } : item
        ),
      },
    })),

  addItem: (dealId, label, category) => {
    const id = `${dealId}-cl-custom-${Date.now()}`;
    set((state) => ({
      itemsByDeal: {
        ...state.itemsByDeal,
        [dealId]: [
          ...(state.itemsByDeal[dealId] ?? []),
          { id, dealId, label, category, checked: false, assignedTo: 'tc', isCustom: true },
        ],
      },
    }));
  },

  removeItem: (dealId, itemId) =>
    set((state) => ({
      itemsByDeal: {
        ...state.itemsByDeal,
        [dealId]: (state.itemsByDeal[dealId] ?? []).filter((item) => item.id !== itemId),
      },
    })),
}));
