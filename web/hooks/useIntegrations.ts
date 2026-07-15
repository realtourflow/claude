"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type IntegrationStatus = {
  configured: boolean;
  connected: boolean;
  scope: 'platform' | 'user';
  account_email?: string;
  /** Connected but the OAuth token can no longer sync — show a Reconnect CTA (#296). */
  needs_reconnect?: boolean;
};

export type IntegrationsResponse = {
  arive: IntegrationStatus;
  docusign: IntegrationStatus;
  stripe: IntegrationStatus;
  google_calendar: IntegrationStatus;
  microsoft_calendar: IntegrationStatus;
};

const EMPTY: IntegrationsResponse = {
  arive: { configured: false, connected: false, scope: 'platform' },
  docusign: { configured: false, connected: false, scope: 'platform' },
  stripe: { configured: false, connected: false, scope: 'platform' },
  google_calendar: { configured: false, connected: false, scope: 'user', needs_reconnect: false },
  microsoft_calendar: { configured: false, connected: false, scope: 'user', needs_reconnect: false },
};

export function useIntegrations() {
  const query = useQuery({
    queryKey: ['me-integrations'],
    queryFn: () => api.get<IntegrationsResponse>('/me/integrations'),
  });

  async function refresh() {
    await query.refetch();
  }

  async function disconnect(provider: 'google_calendar' | 'microsoft_calendar') {
    const path =
      provider === 'google_calendar'
        ? '/me/integrations/google-calendar'
        : '/me/integrations/microsoft-calendar';
    await api.delete(path);
    await refresh();
  }

  async function startOAuth(provider: 'google_calendar' | 'microsoft_calendar'): Promise<void> {
    const path =
      provider === 'google_calendar'
        ? '/me/integrations/google-calendar/start'
        : '/me/integrations/microsoft-calendar/start';
    const { authorize_url } = await api.get<{ authorize_url: string }>(path);
    window.location.assign(authorize_url);
  }

  return {
    status: query.data ?? EMPTY,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh,
    startOAuth,
    disconnect,
  };
}
