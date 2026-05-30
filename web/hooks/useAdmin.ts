"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

// ─── System Config ─────────────────────────────────────────────────────────────

export type StageThresholds = {
  intake: number;
  active_search: number;
  offer_active: number;
  under_contract: number;
  pre_close: number;
  closing: number;
  post_close: number;
};

export type SystemConfig = {
  stage_thresholds: StageThresholds;
  closing_fee_amount: number;
  fast_pass_base_price: number;
  smooth_exit_pct: number;
};

type ConfigResponse = { config: SystemConfig; updated_at: string };

export function useSystemConfig() {
  const queryClient = useQueryClient();
  const queryKey = ['admin-config'];

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<ConfigResponse>('/admin/config'),
  });

  const mutation = useMutation({
    mutationFn: (cfg: SystemConfig) =>
      api.put<ConfigResponse>('/admin/config', { config: cfg }),
    onSuccess: (data) => {
      queryClient.setQueryData<ConfigResponse>(queryKey, data);
    },
  });

  const saveConfig = async (cfg: SystemConfig) => {
    try {
      await mutation.mutateAsync(cfg);
    } catch {
      throw new Error('Failed to save config');
    }
  };

  return {
    config: query.data?.config ?? null,
    updatedAt: query.data?.updated_at ?? null,
    loading: query.isLoading,
    saving: mutation.isPending,
    error:
      query.error instanceof Error
        ? 'Failed to load config'
        : mutation.error instanceof Error
          ? 'Failed to save config'
          : null,
    saveConfig,
  };
}

// ─── Promo Codes ───────────────────────────────────────────────────────────────

export type PromoCode = {
  id: string;
  code: string;
  discountType: 'pct' | 'fixed';
  discountValue: number;
  appliesTo: string[];
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  createdAt: string;
};

function apiToPromoCode(raw: Record<string, unknown>): PromoCode {
  return {
    id: raw.id as string,
    code: raw.code as string,
    discountType: raw.discount_type as 'pct' | 'fixed',
    discountValue: raw.discount_value as number,
    appliesTo: (raw.applies_to as string[]) ?? [],
    maxUses: (raw.max_uses as number | null) ?? null,
    usesCount: raw.uses_count as number,
    expiresAt: (raw.expires_at as string | null) ?? null,
    createdAt: raw.created_at as string,
  };
}

// ─── Audit Log ─────────────────────────────────────────────────────────────────

export type AuditEntry = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  eventType: string;
  dealId: string | null;
  dealTitle: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type AuditLogResponse = { entries: AuditEntry[]; total: number };

function apiToAuditEntry(raw: Record<string, unknown>): AuditEntry {
  return {
    id: raw.id as string,
    actorId: (raw.actor_id as string | null) ?? null,
    actorName: (raw.actor_name as string | null) ?? null,
    actorEmail: (raw.actor_email as string | null) ?? null,
    eventType: raw.event_type as string,
    dealId: (raw.deal_id as string | null) ?? null,
    dealTitle: (raw.deal_title as string | null) ?? null,
    targetId: (raw.target_id as string | null) ?? null,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? null,
    createdAt: raw.created_at as string,
  };
}

export function useAuditLog(eventTypeFilter?: string) {
  const query = useQuery({
    queryKey: ['admin-audit-log', eventTypeFilter ?? ''],
    queryFn: async () => {
      const qs = eventTypeFilter ? `?event_type=${encodeURIComponent(eventTypeFilter)}&limit=200` : '?limit=200';
      const data = await api.get<Record<string, unknown>>(`/admin/audit-log${qs}`);
      const resp = data as unknown as AuditLogResponse;
      return {
        entries: (resp.entries ?? []).map((e) => apiToAuditEntry(e as unknown as Record<string, unknown>)),
        total: resp.total ?? 0,
      };
    },
  });

  return {
    entries: query.data?.entries ?? [],
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: query.error instanceof Error ? 'Failed to load audit log' : null,
  };
}

export type CreatePromoCodeInput = {
  code: string;
  discountType: 'pct' | 'fixed';
  discountValue: number;
  appliesTo: string[];
  maxUses: number | null;
  expiresAt: string | null;
};

export function usePromoCodes() {
  const queryClient = useQueryClient();
  const queryKey = ['admin-promo-codes'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.get<Record<string, unknown>[]>('/admin/promo-codes');
      return data.map(apiToPromoCode);
    },
  });

  const createCode = async (input: CreatePromoCodeInput) => {
    const raw = await api.post<Record<string, unknown>>('/admin/promo-codes', {
      code: input.code,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      applies_to: input.appliesTo,
      max_uses: input.maxUses,
      expires_at: input.expiresAt,
    });
    const created = apiToPromoCode(raw);
    queryClient.setQueryData<PromoCode[]>(queryKey, (prev) => [created, ...(prev ?? [])]);
    return created;
  };

  const deleteCode = async (id: string) => {
    queryClient.setQueryData<PromoCode[]>(queryKey, (prev) =>
      (prev ?? []).filter((c) => c.id !== id),
    );
    try {
      await api.delete<void>(`/admin/promo-codes/${id}`);
    } catch {
      // 204 No Content causes a JSON parse rejection — expected
    }
  };

  return {
    codes: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? 'Failed to load promo codes' : null,
    createCode,
    deleteCode,
  };
}
