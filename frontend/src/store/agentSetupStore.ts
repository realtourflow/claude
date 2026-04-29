import { create } from 'zustand';

type AgentSetupStore = {
  setupComplete: boolean;
  bannerDismissed: boolean;
  markComplete: () => void;
  dismissBanner: () => void;
};

export const useAgentSetupStore = create<AgentSetupStore>((set) => ({
  setupComplete: false,
  bannerDismissed: false,
  markComplete: () => set({ setupComplete: true, bannerDismissed: false }),
  dismissBanner: () => set({ bannerDismissed: true }),
}));
