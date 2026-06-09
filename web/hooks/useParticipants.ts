"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type Participant = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
};

export function useParticipants(dealId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['participants', dealId],
    queryFn: () => api.get<Participant[]>(`/deals/${dealId}/participants`),
    enabled: Boolean(dealId),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['participants', dealId] });

  // Add an existing RealTourFlow user as a participant by email. Surfaces the
  // route's error message (e.g. the 404 "invite them first") to the caller.
  const add = useMutation({
    mutationFn: (input: { email: string; role: string }) =>
      api.post<{ status: string }>(`/deals/${dealId}/participants`, {
        email: input.email.trim(),
        role: input.role,
      }),
    onSuccess: () => { void invalidate(); },
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api.delete<{ status: string }>(`/deals/${dealId}/participants/${userId}`),
    onSuccess: () => { void invalidate(); },
  });

  return {
    participants: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    addParticipant: (input: { email: string; role: string }) =>
      add.mutateAsync(input),
    removeParticipant: (userId: string) => remove.mutateAsync(userId),
    adding: add.isPending,
    removing: remove.isPending,
  };
}
