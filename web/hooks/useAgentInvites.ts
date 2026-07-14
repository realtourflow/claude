"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type AgentInvite = {
  id: string;
  email: string;
  name: string;
  claimed: boolean;
  expiresAt: string;
  createdAt: string;
};

// Shape returned by GET /admin/agent-invites (snake_case, `claimed` boolean).
type ApiAgentInvite = {
  id: string;
  email: string;
  name: string;
  token: string;
  invited_by: string;
  claimed: boolean;
  expires_at: string;
  created_at: string;
};

function fromApi(i: ApiAgentInvite): AgentInvite {
  return {
    id: i.id,
    email: i.email,
    name: i.name,
    claimed: i.claimed,
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  };
}

/**
 * Admin-only: lists agent invites (pending + claimed) and revokes an unclaimed
 * one. Backs the invite list in the admin User Management section (#304).
 * The list/revoke API already existed — this hook is what finally calls it.
 */
export function useAgentInvites() {
  const queryClient = useQueryClient();
  const queryKey = ["admin-agent-invites"];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await api.get<ApiAgentInvite[]>("/admin/agent-invites");
      return raw.map(fromApi);
    },
  });

  // Revokes an unclaimed invite, then drops it from the cached list. The
  // backend rejects revoking a claimed invite (404), so callers only offer
  // this on unclaimed rows.
  async function revokeInvite(inviteId: string): Promise<void> {
    await api.delete(`/admin/agent-invites/${inviteId}`);
    queryClient.setQueryData<AgentInvite[]>(queryKey, (prev) =>
      (prev ?? []).filter((i) => i.id !== inviteId),
    );
  }

  return {
    invites: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? "Failed to load invites" : null,
    refresh: () => {
      void query.refetch();
    },
    revokeInvite,
  };
}
