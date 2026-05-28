"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from "@/lib/api-client";

export type TCInfo = {
  name: string;
  email: string;
  phone: string;
  userId: string | null;
};

type ApiTCInfo = {
  name: string;
  email: string;
  phone: string;
  user_id: string | null;
};

function fromApi(t: ApiTCInfo): TCInfo {
  return { name: t.name, email: t.email, phone: t.phone, userId: t.user_id };
}

export function useTC() {
  const [tc, setTC] = useState<TCInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await api.get<ApiTCInfo>('/me/tc');
      setTC(fromApi(raw));
    } catch {
      setTC(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveTC(name: string, email: string, phone: string): Promise<TCInfo> {
    const raw = await api.put<ApiTCInfo>('/me/tc', { name, email, phone });
    const info = fromApi(raw);
    setTC(info);
    return info;
  }

  async function removeTC(): Promise<void> {
    await api.delete('/me/tc');
    setTC(null);
  }

  return { tc, loading, refresh: load, saveTC, removeTC };
}

export type AgentSummary = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  activeDealCount: number;
};

type ApiAgentSummary = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active_deal_count: number;
};

export function useMyAgents() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ApiAgentSummary[]>('/me/agents')
      .then((rows) => setAgents(rows.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        phone: a.phone,
        activeDealCount: a.active_deal_count,
      }))))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  return { agents, loading };
}
