"use client";

import { api } from "@/lib/api-client";

export type DealInvite = {
  id: string;
  dealId: string;
  email: string;
  name: string;
  role: "buyer" | "seller";
  token: string;
  expiresAt: string;
};

type ApiDealInvite = {
  id: string;
  deal_id: string;
  email: string;
  name: string;
  role: "buyer" | "seller";
  token: string;
  expires_at: string;
};

function apiInviteToFrontend(i: ApiDealInvite): DealInvite {
  return {
    id: i.id,
    dealId: i.deal_id,
    email: i.email,
    name: i.name,
    role: i.role,
    token: i.token,
    expiresAt: i.expires_at,
  };
}

export async function sendDealInvite(
  dealId: string,
  invite: { email: string; name: string; role: "buyer" | "seller" },
): Promise<DealInvite> {
  const i = await api.post<ApiDealInvite>(`/deals/${dealId}/invite`, {
    email: invite.email,
    name: invite.name,
    role: invite.role,
  });
  return apiInviteToFrontend(i);
}

/**
 * Emails an agent-scoped onboarding link to a prospective client. Unlike
 * sendDealInvite this is not tied to a deal — the backend builds a stateless
 * `/onboard/{role}?agent=...` link and sends it best-effort.
 */
export async function sendClientInviteEmail({
  email,
  name,
  role,
}: {
  email: string;
  name: string;
  role: "buyer" | "seller";
}): Promise<{ ok: boolean; inviteUrl: string }> {
  return api.post<{ ok: boolean; inviteUrl: string }>("/me/client-invite", {
    email,
    name,
    role,
  });
}
