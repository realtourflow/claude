"use client";

import { create } from 'zustand';

export type TCInfo = {
  name: string;
  email: string;
  phone?: string;
  /** Present when TC has an account in RealTourFlow */
  userId?: string;
};

type AgentTCStore = {
  /** agentId → TC contact info (null = no TC assigned) */
  agentTCMap: Record<string, TCInfo | null>;
  /** true = agent handles all TC work themselves, no TC assigned */
  soloMode: boolean;
  setTC: (agentId: string, info: TCInfo | null) => void;
  clearTC: (agentId: string) => void;
  setSoloMode: (v: boolean) => void;
};

export const useAgentTCStore = create<AgentTCStore>((set) => ({
  soloMode: false,
  setSoloMode: (v) => set({ soloMode: v }),
  agentTCMap: {
    // Sarah Johnson's TC is Jamie Taylor (in-platform)
    'agent-sarah': {
      name: 'Jamie Taylor',
      email: 'jamie@realtourflow.com',
      phone: '(205) 555-0244',
      userId: 'tc-taylor',
    },
    // Additional demo agents so the TC's "My Agents" list isn't empty
    'agent-marcus': {
      name: 'Jamie Taylor',
      email: 'jamie@realtourflow.com',
      phone: '(205) 555-0244',
      userId: 'tc-taylor',
    },
    'agent-priya': {
      name: 'Jamie Taylor',
      email: 'jamie@realtourflow.com',
      phone: '(205) 555-0244',
      userId: 'tc-taylor',
    },
  },

  setTC: (agentId, info) =>
    set((state) => ({ agentTCMap: { ...state.agentTCMap, [agentId]: info } })),

  clearTC: (agentId) =>
    set((state) => ({ agentTCMap: { ...state.agentTCMap, [agentId]: null } })),
}));

// ─── Mock agent roster for TC's "My Agents" view ─────────────────────────────
// Agents who might not be in MOCK_USERS (demo only). Production derives this
// from the users table filtered by agentTCMap.
export const MOCK_AGENT_ROSTER: {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar: string;
  activeDealCount: number;
  licenseNumber?: string;
}[] = [
  {
    id: 'agent-sarah',
    name: 'Sarah Johnson',
    email: 'sarah@realtourflow.com',
    phone: '(205) 555-0181',
    avatar: 'https://i.pravatar.cc/100?img=47',
    activeDealCount: 4,
    licenseNumber: 'AL-092341',
  },
  {
    id: 'agent-marcus',
    name: 'Marcus Rivera',
    email: 'marcus@realtourflow.com',
    phone: '(205) 555-0133',
    avatar: 'https://i.pravatar.cc/100?img=11',
    activeDealCount: 2,
    licenseNumber: 'AL-088712',
  },
  {
    id: 'agent-priya',
    name: 'Priya Nair',
    email: 'priya@realtourflow.com',
    phone: '(205) 555-0159',
    avatar: 'https://i.pravatar.cc/100?img=9',
    activeDealCount: 3,
    licenseNumber: 'AL-101456',
  },
];
