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
