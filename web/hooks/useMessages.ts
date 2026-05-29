"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type MessageChannel = 'client_thread' | 'internal';

export type Message = {
  id: string;
  dealId: string;
  senderId: string;
  senderName: string;
  senderRole: 'agent' | 'buyer' | 'seller' | 'admin' | 'tc';
  channel: MessageChannel;
  content: string;
  timestamp: string;
  isAiDraft: false;
};

type ApiMessage = {
  id: string;
  deal_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  channel: string;
  body: string;
  created_at: string;
};

function apiMessageToFrontend(m: ApiMessage): Message {
  return {
    id: m.id,
    dealId: m.deal_id,
    senderId: m.sender_id,
    senderName: m.sender_name,
    senderRole: m.sender_role as Message['senderRole'],
    channel: m.channel as MessageChannel,
    content: m.body,
    timestamp: m.created_at,
    isAiDraft: false,
  };
}

export function useMessages(dealId: string, channel: MessageChannel): {
  messages: Message[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const query = useQuery({
    queryKey: ['messages', dealId, channel],
    queryFn: async () => {
      const data = await api.get<ApiMessage[]>(`/deals/${dealId}/messages?channel=${channel}`);
      return data.map(apiMessageToFrontend);
    },
    enabled: Boolean(dealId),
    refetchInterval: 10_000, // Poll every 10s — replaces manual setInterval
  });

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? 'Failed to load messages' : null,
    refresh: () => { void query.refetch(); },
  };
}

export async function postMessage(
  dealId: string,
  channel: MessageChannel,
  body: string,
): Promise<Message> {
  const m = await api.post<ApiMessage>(`/deals/${dealId}/messages`, { channel, body });
  return apiMessageToFrontend(m);
}
