"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type ShowingSlot = {
  day: DayOfWeek;
  from: string;
  to: string;
};

export function useShowingAvailability(dealId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['showing-availability', dealId ?? ''];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const raw = await api.get<ShowingSlot[]>(`/deals/${dealId}/showing-availability`);
        return raw ?? [];
      } catch {
        return [] as ShowingSlot[];
      }
    },
    enabled: Boolean(dealId),
  });

  async function saveSlots(newSlots: ShowingSlot[]) {
    if (!dealId) return;
    await api.put(`/deals/${dealId}/showing-availability`, newSlots);
    queryClient.setQueryData(queryKey, newSlots);
  }

  return {
    slots: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    saveSlots,
  };
}
