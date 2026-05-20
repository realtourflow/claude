import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export type IntegrationStatus = {
  configured: boolean;
  connected: boolean;
  scope: 'platform' | 'user';
  account_email?: string;
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
  google_calendar: { configured: false, connected: false, scope: 'user' },
  microsoft_calendar: { configured: false, connected: false, scope: 'user' },
};

export function useIntegrations() {
  const [status, setStatus] = useState<IntegrationsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<IntegrationsResponse>('/me/integrations');
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
      setStatus(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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

  return { status, loading, error, refresh, startOAuth, disconnect };
}
