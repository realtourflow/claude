import { create } from 'zustand';
import { MockUser, MOCK_USERS, DEFAULT_USER_ID } from '../data/mockUsers';

type AuthStore = {
  activeUserId: string;
  activeUser: MockUser | undefined;
  setActiveUser: (userId: string) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  activeUserId: DEFAULT_USER_ID,
  activeUser: MOCK_USERS.find((u) => u.id === DEFAULT_USER_ID),
  setActiveUser: (userId: string) => {
    set({
      activeUserId: userId,
      activeUser: MOCK_USERS.find((u) => u.id === userId),
    });
  },
}));
