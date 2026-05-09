import { useState, useEffect } from 'react';
import { api } from '../api/client';

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  createdAt: string;
};

type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  created_at: string;
};

export function useUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ApiUser[]>('/users')
      .then((raw) =>
        setUsers(
          raw.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            phone: u.phone,
            createdAt: u.created_at,
          })),
        ),
      )
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  return { users, loading };
}
