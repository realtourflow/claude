"use client";

import { create } from 'zustand';

export type AgentNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  clientName?: string;
  createdAt: string;
  read: boolean;
};

export type ClientNotification = {
  id: string;
  dealId: string;
  title: string;
  body: string;
  createdAt: string;
  dismissed: boolean;
};

type NotificationStore = {
  notifications: AgentNotification[];
  add: (n: Omit<AgentNotification, 'id' | 'createdAt' | 'read'>) => void;
  dismiss: (id: string) => void;
  markAllRead: () => void;

  clientNotifications: ClientNotification[];
  addClientNotification: (n: Omit<ClientNotification, 'id' | 'createdAt' | 'dismissed'>) => void;
  dismissClientNotification: (id: string) => void;
  getClientNotifications: (dealId: string) => ClientNotification[];
};

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],

  add: (n) =>
    set((state) => ({
      notifications: [
        { ...n, id: `notif-${Date.now()}`, createdAt: new Date().toISOString(), read: false },
        ...state.notifications,
      ],
    })),

  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),

  clientNotifications: [],

  addClientNotification: (n) =>
    set((state) => ({
      clientNotifications: [
        { ...n, id: `client-notif-${Date.now()}`, createdAt: new Date().toISOString(), dismissed: false },
        ...state.clientNotifications,
      ],
    })),

  dismissClientNotification: (id) =>
    set((state) => ({
      clientNotifications: state.clientNotifications.map((n) =>
        n.id === id ? { ...n, dismissed: true } : n
      ),
    })),

  getClientNotifications: (dealId) =>
    get().clientNotifications.filter((n) => n.dealId === dealId && !n.dismissed),
}));
