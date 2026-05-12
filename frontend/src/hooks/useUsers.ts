import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  createdAt: string;
  deactivatedAt?: string | null;
};

type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
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
    createdAt: u.created_at,
    deactivatedAt: u.deactivated_at,
  };
}

export function useUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await api.get<ApiUser[]>('/users');
      setUsers(raw.map(fromApi));
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deactivateUser(userId: string): Promise<void> {
    await api.patch(`/users/${userId}/deactivate`, {});
    setUsers((prev) => prev.map((u) =>
      u.id === userId ? { ...u, deactivatedAt: new Date().toISOString() } : u
    ));
  }

  async function activateUser(userId: string): Promise<void> {
    await api.patch(`/users/${userId}/activate`, {});
    setUsers((prev) => prev.map((u) =>
      u.id === userId ? { ...u, deactivatedAt: null } : u
    ));
  }

  return { users, loading, refresh: load, deactivateUser, activateUser };
}
