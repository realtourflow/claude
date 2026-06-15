"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type UserSettings = {
  title?: string;
  licenseNumber?: string;
  bio?: string;
  notifications?: Record<string, boolean>;
  [key: string]: unknown;
};

export function useSettings() {
  const queryClient = useQueryClient();
  const queryKey = ['me-settings'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await api.get<UserSettings>('/me/settings');
      } catch {
        return {} as UserSettings;
      }
    },
  });

  const settings = query.data ?? {};

  async function saveSettings(patch: Partial<UserSettings>) {
    const merged = { ...settings, ...patch };
    queryClient.setQueryData(queryKey, merged);
    try {
      await api.put('/me/settings', merged);
    } catch {
      void query.refetch();
    }
  }

  async function saveProfile(
    name: string,
    phone: string,
    extra?: { market?: string; brokerage?: string },
  ) {
    try {
      await api.patch('/me/profile', { name, phone, ...(extra ?? {}) });
    } catch {
      throw new Error('Failed to save profile');
    }
  }

  return { settings, loading: query.isLoading, saveSettings, saveProfile };
}
