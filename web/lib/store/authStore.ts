"use client";

import { create } from 'zustand';
import { GroupId } from '../permissions/groups';
import { MockUser, MOCK_USERS } from '../data/mockUsers';

export type AppUser = MockUser;

const ROLE_TO_GROUP: Record<string, GroupId> = {
  agent: 'agent',
  buyer: 'buyer',
  seller: 'seller',
  admin: 'admin',
  tc: 'tc',
  lending_partner: 'agent',
};

const ROLE_DISPLAY: Record<string, string> = {
  agent: 'Agent',
  buyer: 'Buyer',
  seller: 'Seller',
  admin: 'Admin',
  tc: 'Transaction Coordinator',
  lending_partner: 'Lending Partner',
};

type AuthStore = {
  activeUser: AppUser | undefined;
  isLoaded: boolean;
  syncError: string | null;
  setFromAuth0: (id: string, name: string, email: string, role: string, onboardingComplete: boolean, avatar?: string) => void;
  setActiveUser: (userId: string) => void;
  setSyncError: (err: string) => void;
  markOnboardingComplete: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  activeUser: undefined,
  isLoaded: false,
  syncError: null,
  setFromAuth0: (id, name, email, role, onboardingComplete, avatar) => {
    const groupId = ROLE_TO_GROUP[role] ?? 'agent';
    set({
      isLoaded: true,
      activeUser: {
        id,
        name,
        email,
        avatar: avatar || `https://i.pravatar.cc/100?u=${encodeURIComponent(id)}`,
        groupId,
        role: ROLE_DISPLAY[role] ?? role,
        dealIds: [],
        onboardingComplete,
      },
    });
  },
  setActiveUser: (userId: string) => {
    const user = MOCK_USERS.find((u) => u.id === userId);
    if (user) set({ activeUser: user, isLoaded: true });
  },
  setSyncError: (err: string) => set({ syncError: err, isLoaded: true }),
  markOnboardingComplete: () =>
    set((s) => s.activeUser ? { activeUser: { ...s.activeUser, onboardingComplete: true } } : {}),
}));
