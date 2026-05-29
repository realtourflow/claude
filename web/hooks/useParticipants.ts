"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type Participant = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
};

export function useParticipants(dealId: string) {
  const query = useQuery({
    queryKey: ['participants', dealId],
    queryFn: () => api.get<Participant[]>(`/deals/${dealId}/participants`),
    enabled: Boolean(dealId),
  });

  return {
    participants: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
  };
}
