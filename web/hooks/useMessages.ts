"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

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

export function useMessages(dealId: string, channel: MessageChannel) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!dealId) return;
    try {
      const data = await api.get<ApiMessage[]>(`/deals/${dealId}/messages?channel=${channel}`);
      setMessages(data.map(apiMessageToFrontend));
      setError(null);
    } catch {
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [dealId, channel]);

  useEffect(() => {
    setLoading(true);
    fetchMessages();
  }, [fetchMessages]);

  // Poll every 10 seconds for new messages
  useEffect(() => {
    if (!dealId) return;
    const id = setInterval(fetchMessages, 10_000);
    return () => clearInterval(id);
  }, [fetchMessages, dealId]);

  return { messages, loading, error, refresh: fetchMessages };
}

export async function postMessage(
  dealId: string,
  channel: MessageChannel,
  body: string,
): Promise<Message> {
  const m = await api.post<ApiMessage>(`/deals/${dealId}/messages`, { channel, body });
  return apiMessageToFrontend(m);
}
