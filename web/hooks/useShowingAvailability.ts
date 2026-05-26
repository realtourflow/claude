"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from "@/lib/api-client";

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type ShowingSlot = {
  day: DayOfWeek;
  from: string;
  to: string;
};

export function useShowingAvailability(dealId: string | undefined) {
  const [slots, setSlots] = useState<ShowingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    try {
      setLoading(true);
      const raw = await api.get<ShowingSlot[]>(`/deals/${dealId}/showing-availability`);
      setSlots(raw ?? []);
    } catch {
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  async function saveSlots(newSlots: ShowingSlot[]) {
    if (!dealId) return;
    await api.put(`/deals/${dealId}/showing-availability`, newSlots);
    setSlots(newSlots);
  }

  return { slots, loading, refresh: load, saveSlots };
}
