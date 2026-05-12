import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export type Participant = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
};

export function useParticipants(dealId: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    try {
      setLoading(true);
      const data = await api.get<Participant[]>(`/deals/${dealId}/participants`);
      setParticipants(data);
    } catch {
      setParticipants([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  return { participants, loading, refresh: load };
}
