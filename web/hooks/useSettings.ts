"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export type UserSettings = {
  title?: string;
  licenseNumber?: string;
  bio?: string;
  notifications?: Record<string, boolean>;
  [key: string]: unknown;
};

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<UserSettings>('/me/settings');
      setSettings(data);
    } catch {
      setSettings({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSettings(patch: Partial<UserSettings>) {
    const merged = { ...settings, ...patch };
    setSettings(merged);
    try {
      await api.put('/me/settings', merged);
    } catch {
      load();
    }
  }

  async function saveProfile(name: string, phone: string) {
    try {
      await api.patch('/me/profile', { name, phone });
    } catch {
      throw new Error('Failed to save profile');
    }
  }

  return { settings, loading, saveSettings, saveProfile };
}
