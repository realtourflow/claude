"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export type AppNotification = {
  id: string;
  title: string;
  body?: string;
  type: string;
  dealId?: string;
  href?: string;
  read: boolean;
  createdAt: string;
};

type ApiNotification = {
  id: string;
  title: string;
  body?: string;
  type: string;
  deal_id?: string;
  href?: string;
  read: boolean;
  created_at: string;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fromApi(n: ApiNotification): AppNotification {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    type: n.type,
    dealId: n.deal_id,
    href: n.href,
    read: n.read,
    createdAt: relativeTime(n.created_at),
  };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    try {
      const raw = await api.get<ApiNotification[]>('/notifications');
      setNotifications(raw.map(fromApi));
    } catch {
      // Silently fail — bell stays empty rather than crashing
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    try {
      await api.patch(`/notifications/${id}/read`, {});
    } catch {
      // Optimistic — don't revert
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await api.post('/notifications/read-all', {});
    } catch {}
  }

  return { notifications, markRead, markAllRead, refresh: load };
}
