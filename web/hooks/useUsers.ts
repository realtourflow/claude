"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  market?: string;
  brokerage?: string;
  createdAt: string;
  deactivatedAt?: string | null;
};

type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  market?: string;
  brokerage?: string;
  created_at: string;
  deactivated_at?: string | null;
};

function fromApi(u: ApiUser): AppUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    phone: u.phone,
    market: u.market ?? "",
    brokerage: u.brokerage ?? "",
    createdAt: u.created_at,
    deactivatedAt: u.deactivated_at,
  };
}

export function useUsers() {
  const queryClient = useQueryClient();
  const queryKey = ['users'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await api.get<ApiUser[]>('/users');
      return raw.map(fromApi);
    },
  });

  async function deactivateUser(userId: string): Promise<void> {
    await api.patch(`/users/${userId}/deactivate`, {});
    queryClient.setQueryData<AppUser[]>(queryKey, (prev) =>
      (prev ?? []).map((u) =>
        u.id === userId ? { ...u, deactivatedAt: new Date().toISOString() } : u,
      ),
    );
  }

  async function activateUser(userId: string): Promise<void> {
    await api.patch(`/users/${userId}/activate`, {});
    queryClient.setQueryData<AppUser[]>(queryKey, (prev) =>
      (prev ?? []).map((u) =>
        u.id === userId ? { ...u, deactivatedAt: null } : u,
      ),
    );
  }

  return {
    users: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    deactivateUser,
    activateUser,
  };
}
